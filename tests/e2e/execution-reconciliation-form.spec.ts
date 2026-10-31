import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, type APIResponse } from "@playwright/test";
import { and, eq } from "../../server/node_modules/drizzle-orm/index.js";
import { createDb, closeRegisteredClients, heartbeatRuns, issueRecoveryActions, issues } from "../../packages/db/src/index.ts";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}

test.describe("execution reconciliation form", () => {
  test.describe.configure({ mode: "serial" });
  let root: string;
  let db: ReturnType<typeof createDb>;
  let dbUrl: string;
  let company: { id: string; issuePrefix: string };
  let agent: { id: string };
  let issue: { id: string; identifier: string };
  let sourceRunId: string;
  let actionId: string;

  test.beforeAll(async ({ request }, testInfo) => {
    test.setTimeout(180_000);
    root = await mkdtemp(path.join(os.tmpdir(), "reconciliation-form-"));
    const config = JSON.parse(await readFile(process.env.PILIBALA_E2E_SERVER_CONFIG!, "utf8"));
    const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
    // Derive the embedded-postgres connection the same way the server does
    // (server/src/index.ts builds its embedded URL from one literal); never
    // log the derived value.
    const serverSource = await readFile("server/src/index.ts", "utf8");
    const passwordMatch = serverSource.match(/postgres:\/\/pilibala:([^@]+)@127\.0\.0\.1/);
    if (!passwordMatch) throw new Error("could not derive the embedded postgres connection from server source");
    dbUrl = `postgres://pilibala:${passwordMatch[1]}@127.0.0.1:${pid.split("\n")[3]}/pilibala`;
    db = createDb(dbUrl);
    company = await json(await request.post("/api/companies", { data: { name: `Reconciliation form ${Date.now()}` } }));
    await writeFile(path.join(root, "continued"), "ready");
    agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
      name: "Reconciliation fixture", role: "engineer", adapterType: "claude_local",
      adapterConfig: { engine: "acp", cwd: root, stateDir: path.join(root, "state"),
        agentCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("scripts/mcp-fixtures/servers/acp-stop-agent.mjs"))}`,
        env: { ANTHROPIC_API_KEY: "acp-stop-fixture-key", PILIBALA_STOP_FIXTURE_ROOT: root, PILIBALA_STOP_FIXTURE_FINISH_TASK: "1" } },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
    } }));
    await expect.poll(async () => (await json(await request.get(`/api/agents/${agent.id}`))).lifecycleState,
      { timeout: 45_000 }).toBe("ready");
    issue = await json(await request.post(`/api/companies/${company.id}/issues`, { data: {
      title: "Reconcile a stopped execution", description: "Answer the pending follow-up once.",
      status: "backlog", assigneeAgentId: agent.id,
    } }));
    sourceRunId = randomUUID();
    // The AMB-135 shape: a failed acpx run, an automatic no-replay stop that
    // settled its watchdog hold with outcome "blocked" (awaiting the operator).
    await db.insert(heartbeatRuns).values({ id: sourceRunId, companyId: company.id, agentId: agent.id,
      status: "failed", processPid: 999999999, errorCode: "acpx_turn_failed",
      error: "Persistent ACP session local-e2e could not be resumed: Internal error",
      startedAt: new Date(Date.now() - 10_000), finishedAt: new Date(Date.now() - 5_000),
      contextSnapshot: { issueId: issue.id },
    });
    actionId = randomUUID();
    await db.insert(issueRecoveryActions).values({ id: actionId, companyId: company.id, sourceIssueId: issue.id,
      kind: "active_run_watchdog", cause: "provider_failure_meaning_unverified", fingerprint: sourceRunId,
      status: "resolved", outcome: "blocked", nextAction: "Automatic recovery stopped.",
      returnOwnerAgentId: agent.id,
      evidence: { runId: sourceRunId, automaticRecovery: { replay: "blocked", actionOutcome: "unknown" } },
    });
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, issue.id));
  });

  test.afterAll(async () => {
    await closeRegisteredClients(dbUrl);
    await rm(root, { recursive: true, force: true });
  });

  test("manual fallback: three required fields gate the submit; not_performed continues the task", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.goto(`/${company.issuePrefix}/issues/${issue.identifier}`);
    const panel = page.getByTestId("execution-reconciliation-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const submit = page.getByTestId("execution-reconciliation-submit");
    const checkbox = page.getByTestId("execution-reconciliation-provider-stopped");
    const select = page.getByTestId("execution-reconciliation-outcome");
    const evidence = page.getByTestId("execution-reconciliation-evidence");

    // The draft-less fallback renders the placeholder outcome: nothing chosen.
    await expect(submit).toBeDisabled();
    // Desktop chat shell: the notice must never squeeze the message history
    // away (the reported PC regression) - it is capped at 45vh and scrolls
    // internally, leaving the thread viewport alive below it. The notice ROOT
    // carries the cap (a child's layout box is not clipped by overflow
    // ancestors), so assert on it and on its internal scrollability.
    const notice = page.getByRole("status", { name: "Task recovery" });
    const noticeBox = await notice.boundingBox();
    const viewport = page.viewportSize()!;
    expect(noticeBox).toBeTruthy();
    expect(noticeBox!.height).toBeLessThanOrEqual(viewport.height * 0.5 + 2);
    const scrollable = await notice.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(scrollable).toBe(true);
    await checkbox.click();
    await expect(submit).toBeDisabled(); // outcome still unchosen
    await select.selectOption("not_performed");
    await expect(submit).toBeDisabled(); // evidence still blank
    await evidence.fill("Verified the provider stopped and no pending external action remains.");
    await expect(submit).toBeEnabled();

    await submit.click();
    // Outcome-aware follow-up: not_performed restores the task to the normal
    // todo admission path and the durable delivery worker wakes the owner.
    await expect.poll(async () => (await json(await request.get(`/api/issues/${issue.id}`))).status,
      { timeout: 120_000 }).toBe("done");
  });

  test("draft prefill: submit live without accept clicks; completed finishes the task", async ({ page, request }) => {
    test.setTimeout(240_000);
    // Re-arm the hold with a Lucy-shaped draft (the AMB-133 19:43 shape).
    await db.update(issueRecoveryActions).set({
      status: "resolved", outcome: "blocked", resolvedAt: null,
      evidence: {
        runId: sourceRunId, automaticRecovery: { replay: "blocked", actionOutcome: "unknown" },
        agentDraft: {
          operatorNote: "No verified provider stop receipt is present.",
          actionOutcome: { value: "mixed", confidence: 0.5, evidence: ["run:" + sourceRunId + "#seq:1"] },
          evidenceSummary: "Timeline: the run was cancelled before its first start; provider state is unverified.",
          providerStopped: { value: false, evidence: ["run:" + sourceRunId + "#seq:2"] },
        },
      },
    }).where(and(eq(issueRecoveryActions.id, actionId), eq(issueRecoveryActions.companyId, company.id)));
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, issue.id));

    await page.goto(`/${company.issuePrefix}/issues/${issue.identifier}`);
    const panel = page.getByTestId("execution-reconciliation-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const submit = page.getByTestId("execution-reconciliation-submit");

    // The draft renders prefilled. Its draft says the stop is UNVERIFIED
    // (providerStopped false): the operator attests the stop, and the button
    // goes live with ZERO "Accept draft" clicks (the reported grey-button
    // regression - draft accepts are a review affordance, never a gate).
    await expect(page.getByTestId("reconciliation-agent-draft")).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByTestId("execution-reconciliation-provider-stopped").click();
    await expect(submit).toBeEnabled();

    // Operator raises the draft's mixed outcome to completed: attesting the
    // external action finished the task resolves it to done - no continuation.
    await page.getByTestId("execution-reconciliation-outcome").selectOption("completed");
    await submit.click();
    await expect.poll(async () => (await json(await request.get(`/api/issues/${issue.id}`))).status,
      { timeout: 60_000 }).toBe("done");
    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
    const reconciliation = (action.evidence as { executionReconciliation?: { actionOutcome?: string } }).executionReconciliation;
    expect(reconciliation?.actionOutcome).toBe("completed");
    // The durable delivery worker sees the done issue and invalidates the
    // pending continuation at the evidence top level.
    await expect.poll(async () => {
      const [row] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, actionId));
      return (row.evidence as { continuationDelivery?: string }).continuationDelivery;
    }, { timeout: 90_000 }).toBe("invalidated");
  });
});
