
import { loadConfig } from "./server/src/config.js";
import { createDb } from "./packages/db/src/client.js";
import { heartbeatService } from "./server/src/services/heartbeat.js";
import { issueRecoveryActions, issues } from "./packages/db/src/schema/index.js";
import { and, eq, sql } from "drizzle-orm";
import { buildReconciledContinuationContext } from "./server/src/services/execution-recovery-resolution.js";
const config = loadConfig();
const db = createDb(config.databaseUrl);
const hb = heartbeatService(db, {});
const pending = await db.select().from(issueRecoveryActions).where(and(eq(issueRecoveryActions.status,"resolved"), sql`${issueRecoveryActions.evidence}->>'continuationDelivery' = 'pending'`)).limit(25);
console.log("pending rows:", pending.length);
for (const action of pending) {
  const decision = action.evidence.executionReconciliation;
  console.log("action", action.id, "hasDecision:", !!decision, "returnOwner:", !!action.returnOwnerAgentId);
  if (!decision || !action.returnOwnerAgentId) continue;
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, action.companyId), eq(issues.id, action.sourceIssueId)));
  console.log("  task:", task?.id, "status:", task?.status, "assigneeMatch:", task?.assigneeAgentId === action.returnOwnerAgentId);
  const run = await hb.wakeup(action.returnOwnerAgentId, {
    source: "automation", triggerDetail: "system", reason: "issue_recovery_action_restored",
    idempotencyKey: `execution-reconciliation:${action.id}`,
    payload: { issueId: task.id, recoveryActionId: action.id },
    requestedByActorType: "system", requestedByActorId: "execution-recovery",
    contextSnapshot: buildReconciledContinuationContext({ issueId: task.id, recoveryActionId: action.id, previousRunId: decision.runId }),
  });
  console.log("  wake result:", run ? run.id : null);
}
process.exit(0);
