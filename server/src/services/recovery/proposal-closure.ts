import { and, eq, inArray, sql } from "drizzle-orm";
import { agents, heartbeatRuns, issueComments, issueRecoveryActions, issues, type Db } from "@paperclipai/db";
import type { ReconciliationFixOption } from "@paperclipai/shared";
import { persistActivity } from "../activity-log.js";
import { logger } from "../../middleware/logger.js";

/**
 * Recovery ladder S7/S9 — fix-proposal decision timeout + closure executor.
 *
 * Two sweeps drive the ladder's fix phase after a doctor's structured
 * fixProposal exists:
 *
 *  1. `settleFixProposalDecisions` — dispatches execution for approved
 *     proposals (user decisions recorded by the resolve endpoint, S6) and
 *     auto-adopts the recommended option when the human decision times out
 *     (R6). Red lines (R5): non-revertible options, manual execution scope,
 *     and options requiring `manual_shell` are NEVER auto-adopted — they are
 *     recorded as a decision timeout and left to the board.
 *
 *  2. `settleCompletedFixRuns` — the closure executor (R7/R8): when the fix
 *     run succeeds, resolve the recovery hold, return the source task to its
 *     owner (todo), and record the closure + revert trail. A failed fix run is
 *     retried a bounded number of times; exhaustion escalates to the board
 *     with the recorded revert steps.
 */

type Wake = ReturnType<typeof import("../heartbeat.js").heartbeatService>["wakeup"];

/** How long a proposal waits for a human decision before timeout semantics. */
export const FIX_PROPOSAL_DECISION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
/** Bounded retries for the fix run itself before the board takes over. */
export const MAX_FIX_RUN_ATTEMPTS = 2;

type FixProposalEvidence = {
  agentDraft?: {
    fixProposal?: {
      title: string;
      rationale: string;
      options: ReconciliationFixOption[];
    } | null;
  } | null;
  agentDraftProvenance?: { agentId?: string; createdAt?: string } | null;
  proposalDecision?: {
    decision: "approved" | "declined";
    optionId: string;
    optionTitle?: string;
    decidedByActorId?: string | null;
    decidedByActorType?: string;
    decidedAt: string;
    autoAdopted?: boolean;
    reason?: string;
  } | null;
  proposalTimeout?: { detectedAt: string; reason: string; recommendedOptionId: string | null } | null;
  closure?: {
    status: "manual_required" | "fix_dispatched" | "verified" | "failed" | "revert_requested" | "reverted";
    fixRunId?: string | null;
    optionId?: string | null;
    optionTitle?: string | null;
    dispatchedAt?: string;
    attempts?: number;
    completedAt?: string;
    boardRequired?: boolean;
    revertSteps?: string[];
    revert?: { requestedAt: string; requestedBy: string; revertRunId?: string | null };
  } | null;
};

export function readFixProposal(action: { evidence: Record<string, unknown> }): FixProposalEvidence["agentDraft"] & { proposal?: NonNullable<NonNullable<FixProposalEvidence["agentDraft"]>["fixProposal"]> } | null {
  const evidence = action.evidence as FixProposalEvidence;
  const proposal = evidence.agentDraft?.fixProposal;
  if (!proposal || !Array.isArray(proposal.options) || proposal.options.length === 0) return null;
  return { ...evidence.agentDraft, proposal };
}

/**
 * R5 red line: an option may be adopted without a fresh human decision only if
 * its effect can be undone and no step requires a human shell.
 */
export function isAutoAdoptableOption(option: ReconciliationFixOption): boolean {
  return (
    option.revertible === true &&
    option.executionScope !== "manual" &&
    !option.permissionRequirements.includes("manual_shell")
  );
}

function mergeEvidence(patch: Record<string, unknown>) {
  return sql`coalesce(${issueRecoveryActions.evidence}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

/**
 * S11 — IM/UI notification. Recovery milestones post a system comment on the
 * source task: it is the Paperclip-native surface that renders in the UI and
 * flows to any bound chat channel. Milestones are one-shot state transitions
 * (guarded by the sweeps' evidence predicates), so comments never repeat.
 */
export async function notifyRecoveryMilestone(
  db: Db,
  action: { companyId: string; sourceIssueId: string; id: string },
  milestone: "proposal_ready" | "auto_adopted" | "decision_timeout_board" | "fix_dispatched" | "fix_verified" | "fix_failed_board" | "revert_requested" | "diagnosis_ready" | "diagnosis_unavailable",
  details: Record<string, unknown>,
) {
  const optionLabel = typeof details.optionTitle === "string" ? details.optionTitle : null;
  const bodies: Record<typeof milestone, string> = {
    proposal_ready: `Recovery: a diagnostic agent proposed a fix${optionLabel ? ` — “${optionLabel}”` : ""}. Open the task to review the proposal and approve or decline it.`,
    auto_adopted: `Recovery: the human decision window elapsed, so the recommended fix${optionLabel ? ` “${optionLabel}”` : ""} was auto-adopted (revertible, audited). Execution follows.`,
    decision_timeout_board: `Recovery: the fix proposal timed out without a decision and its recommended option is not auto-adoptable (manual or non-revertible). Board review required.`,
    fix_dispatched: `Recovery: the approved fix${optionLabel ? ` “${optionLabel}”` : ""} is being executed by a recovery agent. The task stays blocked until the fix is verified.`,
    fix_verified: `Recovery: the fix${optionLabel ? ` “${optionLabel}”` : ""} was executed and verified. The recovery hold is resolved and the task returned to todo.`,
    fix_failed_board: `Recovery: the fix execution failed after its bounded retries. The task is escalated to the board${Array.isArray(details.revertSteps) && details.revertSteps.length > 0 ? "; revert steps are recorded on the recovery action" : ""}.`,
    revert_requested: `Recovery: a revert of the executed fix has been requested; the recovery agent is undoing the recorded steps.`,
    diagnosis_ready: `Recovery: a diagnostic agent's analysis is ready for review. Open the task's recovery panel to read the diagnosis before deciding on the hold.`,
    diagnosis_unavailable: `Recovery: the delegated diagnostic attempts were exhausted without a usable diagnosis. Board review of the recovery hold is required.`,
  };
  try {
    await db.insert(issueComments).values({
      companyId: action.companyId,
      issueId: action.sourceIssueId,
      authorType: "system",
      body: bodies[milestone],
    });
    await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, action.sourceIssueId));
    await persistActivity(db, {
      companyId: action.companyId,
      actorType: "system",
      actorId: "execution-recovery",
      runId: null,
      action: `issue.recovery_notify_${milestone}`,
      entityType: "issue",
      entityId: action.sourceIssueId,
      details: { recoveryActionId: action.id, ...details },
    });
  } catch (err) {
    logger.warn({ err, actionId: action.id, milestone }, "Recovery milestone notification failed");
  }
}

async function logActivity(db: Db, action: { companyId: string; sourceIssueId: string; id: string }, details: Record<string, unknown>, runId?: string | null, actionName = "issue.recovery_fix_lifecycle") {
  await persistActivity(db, {
    companyId: action.companyId,
    actorType: "system",
    actorId: "execution-recovery",
    runId: runId ?? null,
    action: actionName,
    entityType: "issue",
    entityId: action.sourceIssueId,
    details: { recoveryActionId: action.id, ...details },
  });
}

function recoveryFixPrompt(input: {
  actionId: string;
  issueId: string;
  option: ReconciliationFixOption;
  proposalTitle: string;
  revertSteps: string[];
}) {
  return `You are executing an approved recovery fix, not continuing the original task. Do not touch any other task, do not resolve recovery actions, do not change task status. Ignore normal heartbeat work selection.\n` +
    `The recovery action ${input.actionId} on issue ${input.issueId} carries an approved fix proposal "${input.proposalTitle}".\n` +
    `Execute ONLY this approved option:\n` +
    `- Option: ${input.option.title}\n` +
    `- Description: ${input.option.description || "(none)"}\n` +
    `- Execution notes: ${input.option.executionScope}; permission requirements: ${input.option.permissionRequirements.join(", ") || "none"}.\n` +
    `Success is verified against: ${input.option.verificationCriteria}\n` +
    `Record what you changed (commands, files, config) so the step can be audited and reverted. The recorded revert steps are: ${input.revertSteps.length > 0 ? input.revertSteps.join(" | ") : "(none recorded)"}.\n` +
    `If the fix cannot be completed, stop and report the exact failure instead of improvising beyond the option's scope.\n`;
}

/**
 * S9 dispatch: execute an approved fix option by waking a capable agent with a
 * bounded, audited fix prompt. The run is deliberately issue-less (it must not
 * acquire the source task's execution lock).
 */
export async function dispatchFixExecution(
  db: Db,
  wake: Wake | null,
  input: { actionId: string; companyId: string; sourceIssueId: string },
): Promise<{ status: "dispatched" | "manual_required" | "no_agent"; fixRunId?: string }> {
  const [action] = await db.select().from(issueRecoveryActions)
    .where(and(eq(issueRecoveryActions.id, input.actionId), eq(issueRecoveryActions.companyId, input.companyId)));
  if (!action) return { status: "no_agent" };
  const evidence = action.evidence as FixProposalEvidence;
  const found = readFixProposal(action);
  const decision = evidence.proposalDecision;
  if (!found?.proposal || !decision || decision.decision !== "approved") return { status: "no_agent" };
  const option = found.proposal.options.find((entry) => entry.id === decision.optionId);
  if (!option) return { status: "no_agent" };

  if (option.executionScope === "manual") {
    // Red line: a human performs this fix by hand. Record the approval and keep
    // the hold open with explicit next-action wording.
    await db.update(issueRecoveryActions).set({
      evidence: mergeEvidence({ closure: { status: "manual_required", optionId: option.id, optionTitle: option.title } }),
      nextAction: `Approved fix requires manual execution: ${option.title}`,
      updatedAt: new Date(),
    }).where(eq(issueRecoveryActions.id, action.id));
    await logActivity(db, action, { closure: "manual_required", optionId: option.id, optionTitle: option.title });
    return { status: "manual_required" };
  }

  // Choose the executor: the diagnostic agent that produced the proposal first,
  // then the return owner. Both must be live rows (state may have drifted).
  const candidates: string[] = [];
  if (evidence.agentDraftProvenance?.agentId) candidates.push(evidence.agentDraftProvenance.agentId);
  if (action.returnOwnerAgentId) candidates.push(action.returnOwnerAgentId);
  if (action.previousOwnerAgentId) candidates.push(action.previousOwnerAgentId);
  let executor: { id: string; name: string } | null = null;
  for (const candidateId of candidates) {
    const [row] = await db.select({ id: agents.id, name: agents.name, status: agents.status, lifecycleState: agents.lifecycleState })
      .from(agents).where(eq(agents.id, candidateId));
    if (!row || row.status === "paused" || row.status === "terminated" || row.status === "pending_approval") continue;
    if (row.lifecycleState !== "ready") continue;
    executor = { id: row.id, name: row.name };
    break;
  }
  if (!wake || !executor) {
    await db.update(issueRecoveryActions).set({
      evidence: mergeEvidence({ closure: { status: "fix_dispatched", fixRunId: null, optionId: option.id, optionTitle: option.title, dispatchedAt: new Date().toISOString(), attempts: 0 } }),
      updatedAt: new Date(),
    }).where(eq(issueRecoveryActions.id, action.id));
    return { status: "no_agent" };
  }

  const existing = evidence.closure;
  const attempts = existing?.attempts ?? 0;
  const run = await wake(executor.id, {
    source: "automation", triggerDetail: "system", reason: "recovery_fix_execution",
    requestedByActorType: "system", requestedByActorId: "execution-recovery",
    idempotencyKey: `recovery-fix:${action.id}:${attempts}`, allowRunCoalescing: false,
    contextSnapshot: {
      wakeReason: "recovery_fix_execution", forceFreshSession: true,
      fixSourceIssueId: action.sourceIssueId, fixRecoveryActionId: action.id, fixOptionId: option.id,
      recoveryFixPrompt: recoveryFixPrompt({
        actionId: action.id, issueId: action.sourceIssueId, option,
        proposalTitle: found.proposal.title,
        revertSteps: option.revertSteps ?? [],
      }),
    },
  });
  await db.update(issueRecoveryActions).set({
    evidence: mergeEvidence({ closure: { status: "fix_dispatched", fixRunId: run?.id ?? null, optionId: option.id, optionTitle: option.title, dispatchedAt: new Date().toISOString(), attempts: attempts + 1, revertSteps: option.revertSteps ?? [] } }),
    updatedAt: new Date(),
  }).where(eq(issueRecoveryActions.id, action.id));
  if (run) {
    await logActivity(db, action, {
      closure: "fix_dispatched", fixRunId: run.id, optionId: option.id, optionTitle: option.title,
      executorAgentId: executor.id, executorAgentName: executor.name, attempt: attempts + 1,
    }, run.id);
    await notifyRecoveryMilestone(db, action, "fix_dispatched", { optionId: option.id, optionTitle: option.title, fixRunId: run.id });
  }
  return { status: run ? "dispatched" : "no_agent", fixRunId: run?.id };
}

/**
 * S7: proposals waiting for a human decision beyond the timeout either get the
 * recommended option auto-adopted (revertible, no manual shell, non-manual
 * scope — full audit recorded) or are handed to the board with the red-line
 * reason. Idempotent via evidence.proposalTimeout / proposalDecision.
 */
export async function settleFixProposalDecisions(db: Db, wake: Wake | null) {
  const cutoff = new Date(Date.now() - FIX_PROPOSAL_DECISION_TIMEOUT_MS).toISOString();
  const rows = await db.select().from(issueRecoveryActions).where(and(
    inArray(issueRecoveryActions.status, ["active", "escalated"]),
    sql`${issueRecoveryActions.evidence}->'agentDraft'->'fixProposal' IS NOT NULL`,
    sql`${issueRecoveryActions.evidence}->'closure' IS NULL`,
    sql`(
      (
        ${issueRecoveryActions.evidence}->'proposalDecision' IS NULL AND
        ${issueRecoveryActions.evidence}->'proposalTimeout' IS NULL AND
        coalesce(${issueRecoveryActions.evidence}->'agentDraftProvenance'->>'createdAt', ${issueRecoveryActions.evidence}->>'createdAt') < ${cutoff}
      ) OR
      ${issueRecoveryActions.evidence}->'proposalDecision'->>'decision' = 'approved'
    )`,
  ));
  for (const action of rows) {
    try {
      const evidence = action.evidence as FixProposalEvidence;
      const found = readFixProposal(action);
      if (!found?.proposal) continue;
      const alreadyApproved = evidence.proposalDecision?.decision === "approved";
      const recommended = found.proposal.options.find((option) => option.recommended === true) ?? null;
      if (alreadyApproved || (recommended && isAutoAdoptableOption(recommended))) {
        if (!alreadyApproved) {
          await db.update(issueRecoveryActions).set({
            evidence: mergeEvidence({
              proposalDecision: {
                decision: "approved", optionId: recommended!.id, optionTitle: recommended!.title,
                decidedByActorType: "system", decidedAt: new Date().toISOString(),
                autoAdopted: true, reason: "decision_timeout",
              },
            }),
            updatedAt: new Date(),
          }).where(eq(issueRecoveryActions.id, action.id));
          await logActivity(db, action, {
            proposalTimeout: "auto_adopted", optionId: recommended!.id, optionTitle: recommended!.title,
            reason: "decision_timeout", revertible: recommended!.revertible,
          });
        }
        await dispatchFixExecution(db, wake, { actionId: action.id, companyId: action.companyId, sourceIssueId: action.sourceIssueId });
      } else {
        await db.update(issueRecoveryActions).set({
          evidence: mergeEvidence({
            proposalTimeout: {
              detectedAt: new Date().toISOString(),
              reason: recommended
                ? `recommended option not auto-adoptable (scope=${recommended.executionScope}, revertible=${recommended.revertible}, manualShell=${recommended.permissionRequirements.includes("manual_shell")})`
                : "proposal has no recommended option",
              recommendedOptionId: recommended?.id ?? null,
            },
          }),
          updatedAt: new Date(),
        }).where(eq(issueRecoveryActions.id, action.id));
        await logActivity(db, action, {
          proposalTimeout: "board_review", recommendedOptionId: recommended?.id ?? null,
        });
        await notifyRecoveryMilestone(db, action, "decision_timeout_board", { recommendedOptionId: recommended?.id ?? null });
      }
    } catch (err) {
      logger.warn({ err, actionId: action.id }, "Fix proposal timeout settlement failed; retried next sweep");
    }
  }
}

/**
 * S9 closure: watch dispatched fix runs. Success resolves the hold and returns
 * the source task to its owner; failure retries within bounds, then escalates.
 */
export async function settleCompletedFixRuns(db: Db, wake: Wake | null) {
  const rows = await db.select().from(issueRecoveryActions).where(and(
    inArray(issueRecoveryActions.status, ["active", "escalated"]),
    sql`${issueRecoveryActions.evidence}->'closure'->>'status' = 'fix_dispatched'`,
    sql`${issueRecoveryActions.evidence}->'closure'->>'fixRunId' IS NOT NULL`,
  ));
  for (const action of rows) {
    try {
      const evidence = action.evidence as FixProposalEvidence;
      const closure = evidence.closure!;
      if (closure.status !== "fix_dispatched" || !closure.fixRunId) continue;
      const [run] = await db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.id, closure.fixRunId), eq(heartbeatRuns.companyId, action.companyId)));
      if (!run || run.status === "queued" || run.status === "running") continue;

      if (run.status === "succeeded") {
        const done = new Date();
        const [updated] = await db.update(issueRecoveryActions).set({
          status: "resolved", outcome: "restored", resolvedAt: done, updatedAt: done,
          evidence: mergeEvidence({ closure: { ...closure, status: "verified", completedAt: done.toISOString() } }),
        }).where(and(eq(issueRecoveryActions.id, action.id), inArray(issueRecoveryActions.status, ["active", "escalated"]))).returning();
        if (!updated) continue;
        await db.update(issues).set({ status: "todo", updatedAt: done })
          .where(and(eq(issues.id, action.sourceIssueId), eq(issues.companyId, action.companyId), eq(issues.status, "blocked")));
        await logActivity(db, action, {
          closure: "verified", fixRunId: closure.fixRunId, optionId: closure.optionId,
          optionTitle: closure.optionTitle, attempts: closure.attempts ?? 1,
          sourceIssueStatus: "todo",
        }, closure.fixRunId, "issue.recovery_fix_verified");
        await notifyRecoveryMilestone(db, action, "fix_verified", { optionId: closure.optionId, optionTitle: closure.optionTitle });
        continue;
      }

      const attempts = closure.attempts ?? 1;
      if (attempts < MAX_FIX_RUN_ATTEMPTS) {
        await db.update(issueRecoveryActions).set({
          evidence: mergeEvidence({ closure: { ...closure, status: "fix_dispatched", fixRunId: null } }),
          updatedAt: new Date(),
        }).where(eq(issueRecoveryActions.id, action.id));
        await dispatchFixExecution(db, wake, { actionId: action.id, companyId: action.companyId, sourceIssueId: action.sourceIssueId });
        continue;
      }

      // Exhausted: the board decides, with the revert trail visible.
      await db.update(issueRecoveryActions).set({
        status: "escalated", updatedAt: new Date(),
        evidence: mergeEvidence({ closure: { ...closure, status: "failed", boardRequired: true, completedAt: new Date().toISOString() } }),
      }).where(and(eq(issueRecoveryActions.id, action.id), inArray(issueRecoveryActions.status, ["active", "escalated"])));
      await logActivity(db, action, {
        closure: "failed", boardRequired: true, fixRunId: closure.fixRunId,
        optionId: closure.optionId, attempts, revertSteps: closure.revertSteps ?? [],
      }, closure.fixRunId, "issue.recovery_fix_failed");
      await notifyRecoveryMilestone(db, action, "fix_failed_board", {
        optionId: closure.optionId, optionTitle: closure.optionTitle, attempts, revertSteps: closure.revertSteps ?? [],
      });
    } catch (err) {
      logger.warn({ err, actionId: action.id }, "Fix run closure settlement failed; retried next sweep");
    }
  }
}

/**
 * S8: revert an executed fix. Board-only at the route; this wakes the fix
 * executor with the recorded revert steps and records the request.
 */
export async function requestFixRevert(
  db: Db,
  wake: Wake | null,
  input: { companyId: string; sourceIssueId: string; actionId: string; requestedBy: string },
): Promise<{ ok: boolean; error?: string; revertRunId?: string | null }> {
  const [action] = await db.select().from(issueRecoveryActions)
    .where(and(eq(issueRecoveryActions.id, input.actionId), eq(issueRecoveryActions.companyId, input.companyId)));
  if (!action) return { ok: false, error: "not_found" };
  const evidence = action.evidence as FixProposalEvidence;
  const closure = evidence.closure;
  if (!closure || closure.status !== "verified") return { ok: false, error: "no_executed_fix" };
  if (closure.revert) return { ok: false, error: "already_reverted_or_requested" };
  const revertSteps = closure.revertSteps ?? [];
  if (revertSteps.length === 0) return { ok: false, error: "not_revertible" };
  if (!wake) return { ok: false, error: "wakeup_unavailable" };

  const doctorId = evidence.agentDraftProvenance?.agentId ?? action.returnOwnerAgentId ?? action.previousOwnerAgentId;
  if (!doctorId) return { ok: false, error: "no_executor" };
  const run = await wake(doctorId, {
    source: "automation", triggerDetail: "system", reason: "recovery_fix_revert",
    requestedByActorType: "system", requestedByActorId: "execution-recovery",
    idempotencyKey: `recovery-revert:${action.id}`, allowRunCoalescing: false,
    contextSnapshot: {
      wakeReason: "recovery_fix_revert", forceFreshSession: true,
      fixSourceIssueId: action.sourceIssueId, fixRecoveryActionId: action.id,
      recoveryFixPrompt: `You are reverting an executed recovery fix, not continuing any task. Do not touch other tasks, do not change task status.\n` +
        `Execute ONLY these recorded revert steps, in order:\n${revertSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n` +
        `Record exactly what you changed for the audit trail. If a step cannot be undone safely, stop and report instead of improvising.\n`,
    },
  });
  await db.update(issueRecoveryActions).set({
    evidence: mergeEvidence({ closure: { ...closure, status: closure.status, revert: { requestedAt: new Date().toISOString(), requestedBy: input.requestedBy, revertRunId: run?.id ?? null } } }),
    updatedAt: new Date(),
  }).where(eq(issueRecoveryActions.id, action.id));
  await logActivity(db, action, {
    closure: "revert_requested", revertRunId: run?.id ?? null, requestedBy: input.requestedBy,
    revertSteps,
  }, run?.id, "issue.recovery_fix_revert_requested");
  await notifyRecoveryMilestone(db, action, "revert_requested", { revertRunId: run?.id ?? null });
  return { ok: true, revertRunId: run?.id ?? null };
}
