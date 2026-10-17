import { describe, expect, it } from "vitest";
import { buildReconciledContinuationContext } from "./execution-recovery-resolution.js";

describe("reconciled execution continuation", () => {
  it("starts a fresh session with the delivery-gated retry bookkeeping", () => {
    const context = buildReconciledContinuationContext({
      issueId: "issue-1",
      recoveryActionId: "action-1",
      previousRunId: "run-1",
    });

    expect(context).toMatchObject({
      issueId: "issue-1",
      taskId: "issue-1",
      previousRunId: "run-1",
      sourceRunId: "run-1",
      recoveryActionId: "action-1",
      forceFreshSession: true,
      source: "execution.reconciled",
    });
    // The heartbeat queue's reconciliation delivery gate rejects wakes whose
    // context lacks retryOfRunId === the reconciled source run id; without it
    // the continuation is silently skipped and delivery stays pending forever.
    expect(context.retryOfRunId).toBe("run-1");
    // No legacy disposition-repair semantics ride along.
    expect(context).not.toHaveProperty("legacyDispositionEpisode");
  });
});
