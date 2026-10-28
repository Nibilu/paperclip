import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExecutionBlocker, Issue } from "@pilibalaai/shared";
import { requiresExecutionReconciliation } from "@pilibalaai/shared";
import { ExecutionReconciliationPanel } from "./ExecutionReconciliationPanel";
import { WorkspaceReconstructionRecovery } from "./WorkspaceReconstructionRecovery";
import { agentsApi } from "../api/agents";
import { activityApi } from "../api/activity";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { Link } from "../lib/router";
import { deriveRecoveryDisplayState } from "../lib/recovery-display";
import { readRecoveryRetryLineage } from "../lib/recovery-lineage";
import { useSecondTick } from "../hooks/useSecondTick";

// Mirrors the retry tail appended by server execution-blocker.ts. Under a
// no-replay hold the Retry button is hidden, so the tail is misleading.
const RETRY_GUIDANCE_TAIL = " Try again or send a new message to continue once the previous execution has stopped.";

export function ExecutionBlockerNotice({ companyId, issueId, issueStatus, canManage = false, blocker, onRetried, className }: {
  className?: string;
  companyId: string;
  issueId: string;
  issueStatus?: Issue["status"];
  canManage?: boolean;
  blocker: ExecutionBlocker;
  onRetried: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: recovery, error: recoveryError } = useQuery({
    queryKey: queryKeys.issues.recoveryActions(issueId, blocker.recoveryActionId ?? null, blocker.runId ?? null),
    queryFn: () => issuesApi.recoveryActions(issueId),
    enabled: Boolean(blocker.recoveryActionId) && !["done", "cancelled"].includes(issueStatus ?? ""),
    refetchInterval: 5_000,
  });
  const hold = recovery?.actions.find(action => action.id === blocker.recoveryActionId &&
    (action.evidence.runId ?? action.evidence.sourceRunId) === blocker.runId);
  const replayBlocked = (hold?.evidence.automaticRecovery as { replay?: unknown } | undefined)?.replay === "blocked";
  const replayDispositionBlocked = blocker.replayDisposition === "blocked_reconciliation";
  const freshContinuationUnsupported = blocker.freshContinuationDisposition === "unsupported";
  const { data: runs, error: runsError } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
  });
  const failedRun = runs?.find(run => run.runId === blocker.runId &&
    ["failed", "timed_out"].includes(run.status));
  const modelRejected = failedRun?.errorCode === "native_provider_model_rejected";
  const requiresInspection = blocker.cause === "native_continuation_requires_reconciliation" ||
    blocker.cause === "native_session_cleanup_quarantined";
  const retry = useMutation({
    mutationFn: () => agentsApi.retryFailedRun(blocker.agentId!, blocker.runId!, companyId),
    onSuccess: () => {
      onRetried();
      for (const queryKey of [queryKeys.issues.detail(issueId), queryKeys.issues.runs(issueId),
        queryKeys.issues.liveRuns(issueId), queryKeys.issues.activeRun(issueId)]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  const now = Date.now();
  const lineage = hold ? readRecoveryRetryLineage(hold, { now }) : null;
  const recovering = Boolean(!recoveryError && !runsError && hold && !replayBlocked &&
    deriveRecoveryDisplayState(hold, { now }) === "in_progress" && lineage?.hasDurablePath);
  // Identical poll responses do not render again. Recheck a scheduled path's
  // expiry with the shared clock, and stop ticking once it expires or starts.
  useSecondTick(Boolean(recovering && lineage?.nextRetryAt && !lineage.liveRunId));
  if (recovering) return null;
  // When the reconciliation panel renders below, it already owns the no-replay
  // and fresh-continuation guidance; the notice keeps only heading + nextAction.
  const reconciliationPanelVisible = Boolean(canManage && hold && replayBlocked &&
    blocker.replayDisposition === "blocked_reconciliation" && blocker.runId &&
    ["todo", "blocked"].includes(issueStatus ?? "") &&
    requiresExecutionReconciliation(blocker.cause) && !blocker.workspaceRepairRequired);
  const nextActionText = reconciliationPanelVisible &&
    blocker.nextAction.endsWith(RETRY_GUIDANCE_TAIL)
    ? blocker.nextAction.slice(0, -RETRY_GUIDANCE_TAIL.length)
    : blocker.nextAction;
  const hasDetails = Boolean(blocker.runError || (blocker.workspaceRepairRequired && blocker.nextAction) ||
    (canManage && hold && (replayBlocked || hold.resolutionNote)));
  return (
    <div role="status" aria-label="Task recovery" className={cn("task-context-notice flex flex-col items-start gap-2", className)}>
      <div className="min-w-0 break-words">
        <p className="font-medium">{blocker.workspaceReconstructionPending ? "Continuation queued." : modelRejected ? "Model unavailable." : "Work paused."}</p>
        {modelRejected && <p>Choose a supported model or clear the task's model override, then retry.</p>}
        {blocker.workspaceReconstructionPending ? <p>{blocker.nextAction}</p> : blocker.workspaceRepairRequired ? (
          <p>The workspace needs operator attention before work can continue.</p>
        ) : <p>{nextActionText}</p>}
        {replayDispositionBlocked && !reconciliationPanelVisible && (
          <p>
            Pilibala will not replay this stopped run because its external outcome is not verified.
            Inspect the run before requesting any continuation.
          </p>
        )}
        {freshContinuationUnsupported && !reconciliationPanelVisible && (
          <p>
            A new instruction is not available for this adapter until the previous execution is reconciled.
          </p>
        )}
        {Boolean(blocker.savedMessageCount) && (
          <p>{blocker.savedMessageCount} saved {blocker.savedMessageCount === 1 ? "message is" : "messages are"} waiting for recovery.</p>
        )}
        {replayDispositionBlocked && (!canManage || !hold || !replayBlocked) && (
          <p className="text-xs text-muted-foreground" data-testid="reconciliation-unavailable">
            Reconciliation unavailable: {!canManage ? "requires an operator role" : recoveryError ? "recovery action could not be loaded" : !hold ? "matching recovery action is not available yet" : "this action has no no-replay hold"}.
          </p>
        )}
        {canManage && hold && replayBlocked && blocker.replayDisposition === "blocked_reconciliation" && (
          <ExecutionReconciliationPanel key={hold.id} issueId={issueId} issueStatus={issueStatus}
            blocker={blocker} action={hold} onResolved={onRetried} />
        )}
      </div>
      {blocker.agentId && blocker.runId && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/agents/${blocker.agentId}/runs/${blocker.runId}`}>Inspect run</Link>
        </Button>
      )}
      {!blocker.workspaceRepairRequired && (!requiresInspection || blocker.canRetry) && blocker.agentId && blocker.runId &&
        (blocker.canContinue || (!replayDispositionBlocked &&
          ((blocker.cause === "legacy_execution_requires_reconciliation" && failedRun) || blocker.canRetry))) && (
        <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
          {retry.isPending ? "Starting…" : blocker.canContinue ? "Continue" : "Retry"}
        </Button>
      )}
      {retry.isError && (
        <p role="alert" className="w-full text-destructive">{retry.error.message}</p>
      )}
      {runsError && <p role="alert" className="w-full text-destructive">{runsError.message}</p>}
      {hasDetails && <details className="w-full text-muted-foreground">
        <summary className="cursor-pointer">Recovery details</summary>
        {blocker.runError && <p className="break-words">{blocker.runError}</p>}
        {blocker.workspaceRepairRequired && <p>{blocker.nextAction}</p>}
        {canManage && replayBlocked && !reconciliationPanelVisible &&
          <p>Pilibala stopped automatic retries to avoid repeating work with an unknown outcome. Inspect the run before requesting continuation.</p>}
        {canManage && hold?.resolutionNote && <p>{hold.resolutionNote}</p>}
      </details>}
      {recoveryError && <p role="alert" className="w-full text-destructive">Unable to load recovery details: {recoveryError.message}</p>}
      {blocker.canReconstructWorkspace && <WorkspaceReconstructionRecovery key={`reconstruct:${blocker.recoveryActionId}:${blocker.runId}`}
        issueId={issueId} blocker={blocker} canManage={canManage} onRecorded={onRetried} />}
    </div>
  );
}
