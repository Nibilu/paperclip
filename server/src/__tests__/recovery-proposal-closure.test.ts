import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  companies,
  createDb,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
} from "@pilibalaai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  dispatchFixExecution,
  isAutoAdoptableOption,
  MAX_FIX_RUN_ATTEMPTS,
  requestFixRevert,
  settleCompletedFixRuns,
  settleFixProposalDecisions,
} from "../services/recovery/proposal-closure.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type WakeCall = { agentId: string; payload: Record<string, unknown> };

function makeWake(
  calls: WakeCall[],
  runStatus: "succeeded" | "failed" = "succeeded",
  persist?: (runId: string, agentId: string) => Promise<void>,
) {
  return vi.fn(async (agentId: string, payload: Record<string, unknown>) => {
    const runId = randomUUID();
    calls.push({ agentId, payload });
    if (persist) await persist(runId, agentId);
    return { id: runId, status: runStatus };
  }) as unknown as ReturnType<typeof import("../services/heartbeat.js").heartbeatService>["wakeup"];
}

const RECOMMENDED_OPTION = {
  id: "clear-model",
  title: "Clear the agent's model field",
  description: "Falls back to the default profile model.",
  recommended: true,
  permissionRequirements: ["adapter_config_change" as const],
  revertible: true,
  revertSteps: ["Re-add the model field"],
  executionScope: "server_side" as const,
  verificationCriteria: "A new run starts without acpx_session_config_failed.",
};

function proposalEvidence(options: unknown = [RECOMMENDED_OPTION], createdAt = new Date().toISOString(), doctorId = randomUUID()) {
  return {
    agentDraft: {
      providerStopped: { value: false, evidence: ["run:r#seq:1"] },
      actionOutcome: { value: "not_performed", confidence: 0.7, evidence: ["run:r#seq:2"] },
      evidenceSummary: "Timeline reconstructed from the run events with seq references.",
      operatorNote: "",
      fixProposal: { title: "Restore the ACP lane", rationale: "Model config blocks every run.", options },
    },
    agentDraftProvenance: { agentId: doctorId, createdAt },
  };
}

describeEmbeddedPostgres("recovery proposal closure (S7/S8/S9)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let operationLogRoot: string;
  const priorOperationLogRoot = process.env.WORKSPACE_OPERATION_LOG_BASE_PATH;

  beforeAll(async () => {
    operationLogRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pilibala-proposal-closure-logs-"));
    process.env.WORKSPACE_OPERATION_LOG_BASE_PATH = operationLogRoot;
    tempDb = await startEmbeddedPostgresTestDatabase("pilibala-proposal-closure-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(issueRecoveryActions);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (priorOperationLogRoot === undefined) delete process.env.WORKSPACE_OPERATION_LOG_BASE_PATH;
    else process.env.WORKSPACE_OPERATION_LOG_BASE_PATH = priorOperationLogRoot;
    await fs.rm(operationLogRoot, { recursive: true, force: true });
  });

  async function seedFixture() {
    const companyId = randomUUID();
    const doctorId = randomUUID();
    const ownerId = randomUUID();
    const sourceIssueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Closure Co",
      issuePrefix: `PC${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      { id: doctorId, companyId, name: "Doctor", role: "cto", status: "idle", lifecycleState: "ready",
        adapterType: "hermes_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
      { id: ownerId, companyId, name: "Owner", role: "engineer", status: "idle", lifecycleState: "ready",
        adapterType: "hermes_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
    ]);
    await db.insert(issues).values({
      id: sourceIssueId,
      companyId,
      identifier: `PC-${randomUUID().slice(0, 6)}`,
      title: "Blocked on a broken lane",
      status: "blocked",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof issues.$inferInsert);
    return { companyId, doctorId, ownerId, sourceIssueId };
  }

  async function seedHold(input: {
    companyId: string;
    sourceIssueId: string;
    evidence: Record<string, unknown>;
    status?: "active" | "escalated";
    returnOwnerAgentId?: string | null;
  }) {
    const actionId = randomUUID();
    await db.insert(issueRecoveryActions).values({
      id: actionId,
      companyId: input.companyId,
      sourceIssueId: input.sourceIssueId,
      kind: "stranded_assigned_issue",
      status: input.status ?? "active",
      ownerType: "board",
      ownerAgentId: null,
      ownerUserId: null,
      previousOwnerAgentId: null,
      returnOwnerAgentId: input.returnOwnerAgentId ?? null,
      cause: "issue_continuation_recovery_failed",
      fingerprint: `proposal:${actionId}`,
      evidence: input.evidence,
      nextAction: "A diagnostic agent proposed a fix.",
      wakePolicy: { type: "board_escalation" },
      monitorPolicy: null,
      attemptCount: 1,
      maxAttempts: 3,
      timeoutAt: null,
      lastAttemptAt: null,
      outcome: null,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return actionId;
  }

  async function seedFixRun(input: { companyId: string; doctorId: string; issueId: string; status: "succeeded" | "failed" }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.doctorId,
      status: input.status,
      contextSnapshot: { wakeReason: "recovery_fix_execution", fixSourceIssueId: input.issueId },
    });
    return runId;
  }

  it("auto-adopts the recommended revertible option after the decision timeout and dispatches a fix run (S7+R6)", async () => {
    const { companyId, doctorId, sourceIssueId } = await seedFixture();
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const actionId = await seedHold({ companyId, sourceIssueId, evidence: proposalEvidence([RECOMMENDED_OPTION], stale, doctorId) });
    const wakeCalls: WakeCall[] = [];
    const wake = makeWake(wakeCalls);

    await settleFixProposalDecisions(db, wake);

    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.evidence.proposalDecision).toMatchObject({
      decision: "approved", optionId: "clear-model", autoAdopted: true, reason: "decision_timeout",
    });
    expect(action.evidence.closure).toMatchObject({ status: "fix_dispatched" });
    expect(action.evidence.closure.fixRunId).toEqual(expect.any(String));
    expect(wakeCalls).toHaveLength(1);
    expect(wakeCalls[0].agentId).toBe(doctorId);
    expect(wakeCalls[0].payload.contextSnapshot.wakeReason).toBe("recovery_fix_execution");
    // Idempotent: a second pass does not re-adopt or re-dispatch.
    await settleFixProposalDecisions(db, wake);
    expect(wakeCalls).toHaveLength(1);
  });

  it("never auto-adopts red-line options (manual_shell, non-revertible, manual scope) — hands them to the board (R5)", async () => {
    const { companyId, sourceIssueId } = await seedFixture();
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const redLineOption = {
      ...RECOMMENDED_OPTION,
      id: "manual-shell",
      permissionRequirements: ["manual_shell" as const],
    };
    expect(isAutoAdoptableOption(redLineOption)).toBe(false);
    const actionId = await seedHold({ companyId, sourceIssueId, evidence: proposalEvidence([redLineOption], stale, randomUUID()) });
    const wakeCalls: WakeCall[] = [];
    const wake = makeWake(wakeCalls);

    await settleFixProposalDecisions(db, wake);

    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.evidence.proposalDecision).toBeUndefined();
    expect(action.evidence.proposalTimeout).toMatchObject({ reason: expect.stringContaining("manualShell=true") });
    expect(wakeCalls).toHaveLength(0);
  });

  it("dispatches execution for a user-approved proposal on the next sweep (S6→S9 handoff)", async () => {
    const { companyId, doctorId, sourceIssueId } = await seedFixture();
    const evidence = proposalEvidence([RECOMMENDED_OPTION], new Date().toISOString(), doctorId) as Record<string, unknown>;
    evidence.proposalDecision = {
      decision: "approved", optionId: "clear-model", decidedByActorType: "board", decidedAt: new Date().toISOString(),
    };
    const actionId = await seedHold({ companyId, sourceIssueId, evidence });
    const wakeCalls: WakeCall[] = [];

    await settleFixProposalDecisions(db, makeWake(wakeCalls));

    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.evidence.closure).toMatchObject({ status: "fix_dispatched", optionId: "clear-model" });
    expect(wakeCalls[0].agentId).toBe(doctorId);
  });

  it("records manual_required for an approved manual-scope option without waking anyone (red line)", async () => {
    const { companyId, doctorId, sourceIssueId } = await seedFixture();
    const evidence = proposalEvidence([{
      ...RECOMMENDED_OPTION,
      id: "hand-fix",
      executionScope: "manual" as const,
    }], new Date().toISOString(), doctorId) as Record<string, unknown>;
    evidence.proposalDecision = {
      decision: "approved", optionId: "hand-fix", decidedByActorType: "board", decidedAt: new Date().toISOString(),
    };
    const actionId = await seedHold({ companyId, sourceIssueId, evidence });
    const wakeCalls: WakeCall[] = [];

    const result = await dispatchFixExecution(db, makeWake(wakeCalls), { actionId, companyId, sourceIssueId });

    expect(result.status).toBe("manual_required");
    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.evidence.closure).toMatchObject({ status: "manual_required" });
    expect(action.nextAction).toContain("manual execution");
    expect(wakeCalls).toHaveLength(0);
  });

  it("closes the loop on a successful fix run: resolve the hold and return the task to todo (R7)", async () => {
    const { companyId, doctorId, sourceIssueId } = await seedFixture();
    const fixRunId = await seedFixRun({ companyId, doctorId, issueId: sourceIssueId, status: "succeeded" });
    const evidence = { ...proposalEvidence([RECOMMENDED_OPTION], new Date().toISOString(), doctorId), proposalDecision: { decision: "approved", optionId: "clear-model", decidedAt: new Date().toISOString() }, closure: { status: "fix_dispatched", fixRunId, optionId: "clear-model", optionTitle: RECOMMENDED_OPTION.title, dispatchedAt: new Date().toISOString(), attempts: 1, revertSteps: ["Re-add the model field"] } };
    const actionId = await seedHold({ companyId, sourceIssueId, evidence });

    const wakeCalls: WakeCall[] = [];
    await settleCompletedFixRuns(db, makeWake(wakeCalls));

    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.status).toBe("resolved");
    expect(action.outcome).toBe("restored");
    expect(action.evidence.closure).toMatchObject({ status: "verified", completedAt: expect.any(String) });
    const [task] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(task.status).toBe("todo");
  });

  it("retries a failed fix run within bounds, then escalates to the board with the revert trail (R8)", async () => {
    const { companyId, doctorId, sourceIssueId } = await seedFixture();
    const fixRunId = await seedFixRun({ companyId, doctorId, issueId: sourceIssueId, status: "failed" });
    const evidence = { ...proposalEvidence([RECOMMENDED_OPTION], new Date().toISOString(), doctorId), proposalDecision: { decision: "approved", optionId: "clear-model", decidedAt: new Date().toISOString() }, closure: { status: "fix_dispatched", fixRunId, optionId: "clear-model", dispatchedAt: new Date().toISOString(), attempts: 1, revertSteps: ["Re-add the model field"] } };
    const actionId = await seedHold({ companyId, sourceIssueId, evidence });
    const wakeCalls: WakeCall[] = [];
    const wake = makeWake(wakeCalls, "failed", async (runId, agentId) => {
      await db.insert(heartbeatRuns).values({
        id: runId, companyId, agentId, status: "failed",
        contextSnapshot: { wakeReason: "recovery_fix_execution", fixSourceIssueId: sourceIssueId },
      });
    });

    // First pass: retry re-dispatches (attempts 1 -> 2). The re-dispatched run
    // persists as failed, so the next sweep observes the second failure.
    await settleCompletedFixRuns(db, wake);
    expect(wakeCalls).toHaveLength(1);
    let [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.evidence.closure.attempts).toBe(2);
    expect(action.evidence.closure.fixRunId).toEqual(expect.any(String));

    // Second pass: the persisted retry run is failed -> attempts exhausted -> escalate.
    await settleCompletedFixRuns(db, wake);
    [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.status).toBe("escalated");
    expect(action.evidence.closure).toMatchObject({ status: "failed", boardRequired: true });
    expect(action.evidence.closure.revertSteps).toEqual(["Re-add the model field"]);
  });

  it("S8 revert: wakes the executor with the recorded revert steps and records the request; refuses non-revertible", async () => {
    const { companyId, doctorId, sourceIssueId } = await seedFixture();
    const evidence = { ...proposalEvidence([RECOMMENDED_OPTION], new Date().toISOString(), doctorId), proposalDecision: { decision: "approved", optionId: "clear-model", decidedAt: new Date().toISOString() }, closure: { status: "verified", fixRunId: randomUUID(), optionId: "clear-model", optionTitle: RECOMMENDED_OPTION.title, revertSteps: ["Re-add the model field"] } };
    const actionId = await seedHold({ companyId, sourceIssueId, evidence, status: "resolved" });
    // The revert route works on resolved actions; run against the same row by
    // flipping it back to a resolvable state for the service call.
    await db.update(issueRecoveryActions).set({ status: "escalated" }).where(eq(issueRecoveryActions.id, actionId));
    const wakeCalls: WakeCall[] = [];
    const wake = makeWake(wakeCalls, "succeeded", async (runId, agentId) => {
      await db.insert(heartbeatRuns).values({
        id: runId, companyId, agentId, status: "queued",
        contextSnapshot: { wakeReason: "recovery_fix_revert", fixSourceIssueId: sourceIssueId },
      });
    });

    const result = await requestFixRevert(db, wake, {
      companyId, sourceIssueId, actionId, requestedBy: "board-user-1",
    });

    expect(result.ok).toBe(true);
    expect(result.revertRunId).toEqual(expect.any(String));
    expect(wakeCalls[0].agentId).toBe(doctorId);
    const prompt = String(wakeCalls[0].payload.contextSnapshot.recoveryFixPrompt);
    expect(prompt).toContain("Re-add the model field");
    expect(prompt).toContain("reverting");
    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    expect(action.evidence.closure.revert).toMatchObject({ requestedBy: "board-user-1" });

    // Non-revertible executed fix is refused (second issue: one active hold per source).
    const secondIssueId = randomUUID();
    await db.insert(issues).values({
      id: secondIssueId,
      companyId,
      identifier: `PC-${randomUUID().slice(0, 6)}`,
      title: "Second blocked task",
      status: "blocked",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof issues.$inferInsert);
    const noRevert = { ...proposalEvidence([RECOMMENDED_OPTION], new Date().toISOString(), doctorId), closure: { status: "verified", fixRunId: randomUUID(), optionId: "x", revertSteps: [] } };
    const actionId2 = await seedHold({ companyId, sourceIssueId: secondIssueId, evidence: noRevert, status: "resolved" });
    await db.update(issueRecoveryActions).set({ status: "escalated" }).where(eq(issueRecoveryActions.id, actionId2));
    const refused = await requestFixRevert(db, makeWake([]), { companyId, sourceIssueId: secondIssueId, actionId: actionId2, requestedBy: "board-user-1" });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("not_revertible");
  });

  it("S7 respects MAX_FIX_RUN_ATTEMPTS bound constant used by the closure loop", () => {
    expect(MAX_FIX_RUN_ATTEMPTS).toBe(2);
  });
});
