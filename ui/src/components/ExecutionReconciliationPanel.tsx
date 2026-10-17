import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ExecutionBlocker, Issue, IssueRecoveryAction } from "@paperclipai/shared";
import { requiresExecutionReconciliation } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { Button } from "./ui/button";

const OUTCOMES = [
  ["not_performed", "Not performed"],
  ["completed", "Completed"],
  ["mixed", "Partially completed / mixed"],
] as const;

type ActionOutcome = (typeof OUTCOMES)[number][0];

export function ExecutionReconciliationPanel({
  issueId,
  issueStatus,
  blocker,
  action,
  onResolved,
}: {
  issueId: string;
  issueStatus?: Issue["status"];
  blocker: ExecutionBlocker;
  action: IssueRecoveryAction;
  onResolved: () => void;
}) {
  const [providerStopped, setProviderStopped] = useState(false);
  const [actionOutcome, setActionOutcome] = useState<ActionOutcome>("not_performed");
  const [outcomeEvidence, setOutcomeEvidence] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const sourceRunId = blocker.runId ??
    (typeof action.evidence.runId === "string" ? action.evidence.runId :
      typeof action.evidence.sourceRunId === "string" ? action.evidence.sourceRunId : null);
  const mutation = useMutation({
    mutationFn: () => issuesApi.resolveRecoveryAction(issueId, {
      actionId: action.id,
      outcome: "restored",
      sourceIssueStatus: "todo",
      resolutionNote: resolutionNote.trim() || null,
      executionReconciliation: {
        runId: sourceRunId!,
        providerStopped: true,
        actionOutcome,
        outcomeEvidence: outcomeEvidence.trim(),
      },
    }),
    onSuccess: onResolved,
  });

  if (
    !["todo", "blocked"].includes(issueStatus ?? "") ||
    !requiresExecutionReconciliation(blocker.cause) ||
    blocker.workspaceRepairRequired ||
    !sourceRunId
  ) return null;

  const evidenceReady = outcomeEvidence.trim().length >= 20;
  const canSubmit = providerStopped && evidenceReady && !mutation.isPending;
  return (
    <section
      className="w-full rounded-md border border-amber-400/40 bg-amber-500/5 p-3 text-sm"
      data-testid="execution-reconciliation-panel"
      aria-label="Execution reconciliation"
    >
      <div className="space-y-1">
        <h3 className="font-medium">Verify the stopped execution before continuing</h3>
        <p className="text-muted-foreground">
          The previous execution will not be replayed. Confirm the provider stopped and record what happened;
          Paperclip will create a fresh continuation only after the server rechecks the recovery gates.
          {issueStatus === "blocked" ? " Submitting this decision restores the task to the normal todo admission path." : ""}
        </p>
        <p className="text-xs text-muted-foreground">Source run: <code>{sourceRunId}</code></p>
      </div>
      <div className="mt-3 space-y-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={providerStopped}
            onChange={(event) => setProviderStopped(event.target.checked)}
            data-testid="execution-reconciliation-provider-stopped"
          />
          <span>I verified that the provider and its execution environment have stopped.</span>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Observed external action outcome</span>
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5"
            value={actionOutcome}
            onChange={(event) => setActionOutcome(event.target.value as ActionOutcome)}
            data-testid="execution-reconciliation-outcome"
          >
            {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Evidence <span className="text-muted-foreground">(required)</span></span>
          <textarea
            className="min-h-20 w-full rounded-md border border-input bg-background px-2 py-1.5"
            value={outcomeEvidence}
            onChange={(event) => setOutcomeEvidence(event.target.value)}
            placeholder="Describe the provider receipt, tool result, or external confirmation you inspected."
            data-testid="execution-reconciliation-evidence"
            aria-required="true"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Operator note <span className="text-muted-foreground">(optional)</span></span>
          <textarea
            className="min-h-16 w-full rounded-md border border-input bg-background px-2 py-1.5"
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            data-testid="execution-reconciliation-note"
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          data-testid="execution-reconciliation-submit"
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Recording…" : "Record outcome and continue"}
        </Button>
        {mutation.isError && <p role="alert" className="text-destructive">{mutation.error.message}</p>}
      </div>
    </section>
  );
}
