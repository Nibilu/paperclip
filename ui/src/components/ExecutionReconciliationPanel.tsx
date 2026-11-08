import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ExecutionBlocker, Issue, IssueRecoveryAction } from "@pilibalaai/shared";
import { requiresExecutionReconciliation } from "@pilibalaai/shared";
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
  // "" = the operator has not chosen yet; the three required fields are the
  // verified-stop checkbox, this explicit outcome choice, and the evidence.
  const [actionOutcome, setActionOutcome] = useState<ActionOutcome | "">("");
  const [outcomeEvidence, setOutcomeEvidence] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const draft = action.agentDraft;
  type Field = "providerStopped" | "actionOutcome" | "evidenceSummary" | "operatorNote";
  const [reviewed, setReviewed] = useState<Partial<Record<Field, boolean>>>({});
  const review = (field: Field) => setReviewed(previous => ({ ...previous, [field]: true }));
  // Prefill exactly once per draft. The previous effect re-ran on every
  // `reviewed` change and overwrote any not-yet-accepted field with the draft
  // value - the reported "items 2-4 blank / edits snap back" bug.
  const prefilledDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || prefilledDraftRef.current === action.id) return;
    prefilledDraftRef.current = action.id;
    setProviderStopped(draft.providerStopped.value);
    setActionOutcome(draft.actionOutcome.value);
    setOutcomeEvidence(draft.evidenceSummary);
    setResolutionNote(draft.operatorNote);
  }, [action.id, draft]);
  const accept = (field: Field) => draft && (
    <Button type="button" variant="outline" size="sm" disabled={Boolean(reviewed[field])}
      data-testid={`accept-draft-${field}`} onClick={() => review(field)}>
      {reviewed[field] ? "Reviewed" : "Accept draft"}
    </Button>
  );
  const sourceRunId = blocker.runId ??
    (typeof action.evidence.runId === "string" ? action.evidence.runId :
      typeof action.evidence.sourceRunId === "string" ? action.evidence.sourceRunId : null);
  const mutation = useMutation({
    mutationFn: () => issuesApi.resolveRecoveryAction(issueId, {
      actionId: action.id,
      outcome: "restored",
      // Outcome-aware follow-up: an operator-attested "completed" external
      // action finishes the task (done; the continuation delivery worker
      // invalidates a pending continuation on a done issue). "not_performed"
      // and "mixed" continue the task on the normal todo admission path with
      // the recorded evidence.
      sourceIssueStatus: actionOutcome === "completed" ? "done" : "todo",
      resolutionNote: resolutionNote.trim() || null,
      executionReconciliation: {
        runId: sourceRunId!,
        // Server contract (resolve schema) attests `true`: the checkbox above
        // gates submission, so a submission always records a verified stop.
        providerStopped: true,
        // canSubmit guarantees the operator chose an outcome before this runs.
        actionOutcome: actionOutcome as ActionOutcome,
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
  ) return <p className="text-xs text-muted-foreground">Reconciliation unavailable: {
    !["todo", "blocked"].includes(issueStatus ?? "") ? "task must be todo or blocked" :
    blocker.workspaceRepairRequired ? "workspace repair is required first" :
    !sourceRunId ? "source run is missing" : "this recovery cause requires a different action"
  }.</p>;

  const analysis = action.evidence.reconciliationAnalysis as { status?: string } | undefined;
  const diagnosisUnavailable = analysis?.status === "unavailable";
  // The diagnostic agent goes FIRST: while its analysis is still pending or
  // running, this panel only reports progress and the manual fallback stays
  // hidden - the human path is the last resort after automatic diagnosis, not
  // a race against the doctor run.
  const diagnosisInProgress = !draft && !diagnosisUnavailable &&
    ["pending", "dispatching", "requested"].includes(analysis?.status ?? "");

  const evidenceReady = outcomeEvidence.trim().length >= 20;
  // Exactly THREE required fields gate the submit: the verified-stop checkbox,
  // the explicit outcome choice, and evidence. Draft "accept" buttons are a
  // review affordance, never a gate - the manual fallback must be submittable
  // without them (AMB-133/135: grey button with every required field filled).
  const outcomeChosen = actionOutcome !== "";
  const canSubmit = providerStopped && outcomeChosen && evidenceReady && !mutation.isPending;
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
          Pilibala will create a fresh continuation only after the server rechecks the recovery gates.
          The previous execution will not be replayed. Confirm the provider stopped, choose what happened, and record the evidence.
          Recording "Completed" finishes the task; "Not performed" or "Partially completed" continues it with a fresh run after the server rechecks the recovery gates.
          {issueStatus === "blocked" ? " Submitting this decision restores the task to the normal todo admission path." : ""}
        </p>
        <p className="text-xs text-muted-foreground">Source run: <code>{sourceRunId}</code></p>
      </div>
      {draft && <p className="mt-3 text-muted-foreground" data-testid="reconciliation-agent-draft">
        Agent draft: review or edit each field before submitting. Outcome confidence: {Math.round(draft.actionOutcome.confidence * 100)}%.
      </p>}
      {!draft && <p className="mt-3 text-muted-foreground" data-testid="reconciliation-diagnosis-state">
        {diagnosisUnavailable
          ? "Agent diagnosis is unavailable for this hold. Record the outcome manually."
          : diagnosisInProgress
            ? "Agent diagnosis is in progress; the prefilled draft will appear here when it completes. The manual form becomes available if the diagnosis cannot complete."
            : "Agent diagnosis is not scheduled for this hold. Record the outcome manually."}
      </p>}
      {!diagnosisInProgress && <div className="mt-3 space-y-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={providerStopped}
            onChange={(event) => { setProviderStopped(event.target.checked); review("providerStopped"); }}
            data-testid="execution-reconciliation-provider-stopped"
          />
          <span>I verified that the provider and its execution environment have stopped.</span>
        </label>
        {draft && <p className="text-xs text-muted-foreground">{draft.providerStopped.evidence.join("; ")}</p>}
        {accept("providerStopped")}
        <label className="block space-y-1">
          <span className="text-xs font-medium">Observed external action outcome</span>
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5"
            value={actionOutcome}
            onChange={(event) => { setActionOutcome(event.target.value as ActionOutcome); review("actionOutcome"); }}
            data-testid="execution-reconciliation-outcome"
          >
            <option value="" disabled>Select the observed external outcome</option>
            {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {draft && <p className="text-xs text-muted-foreground">{draft.actionOutcome.evidence.join("; ")}</p>}
        {accept("actionOutcome")}
        <label className="block space-y-1">
          <span className="text-xs font-medium">Evidence <span className="text-muted-foreground">(required)</span></span>
          <textarea
            className="min-h-20 w-full rounded-md border border-input bg-background px-2 py-1.5"
            value={outcomeEvidence}
            onChange={(event) => { setOutcomeEvidence(event.target.value); review("evidenceSummary"); }}
            placeholder="Describe the provider receipt, tool result, or external confirmation you inspected."
            data-testid="execution-reconciliation-evidence"
            aria-required="true"
          />
        </label>
        {accept("evidenceSummary")}
        <label className="block space-y-1">
          <span className="text-xs font-medium">Operator note <span className="text-muted-foreground">(optional)</span></span>
          <textarea
            className="min-h-16 w-full rounded-md border border-input bg-background px-2 py-1.5"
            value={resolutionNote}
            onChange={(event) => { setResolutionNote(event.target.value); review("operatorNote"); }}
            data-testid="execution-reconciliation-note"
          />
        </label>
        {accept("operatorNote")}
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
      </div>}
    </section>
  );
}
