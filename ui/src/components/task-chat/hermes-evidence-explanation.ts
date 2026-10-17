import type { HermesRunEvidence } from "@paperclipai/shared";

/**
 * Operator-facing projection of Hermes Gateway run evidence (SPEC-implementation
 * 11.2 + AMB-25). Converts the run's `resultJson.hermesEvidence` (+ adapter
 * error code) into the marker copy TaskChatThread renders. The explanation must
 * name the block and the next action, distinguish liveness from interface
 * support, and never imply that a lost response proves non-dispatch or that a
 * stop acknowledgement proves a completed effect.
 */

interface HermesEvidenceExplanation {
  label: string;
  detail: string;
  /** Whether the UI may offer retry; reconciliation cases forbid it. */
  retryable: boolean;
}

function evidenceFromRun(run: {
  adapterType?: string | null;
  errorCode?: string | null;
  resultJson?: Record<string, unknown> | null;
}): HermesRunEvidence | null {
  if (run.adapterType !== "hermes_gateway") return null;
  const candidate = run.resultJson?.hermesEvidence;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    typeof (candidate as Record<string, unknown>).state !== "string"
  ) {
    return null;
  }
  return candidate as HermesRunEvidence;
}

const EVIDENCE_LABELS: Record<string, string> = {
  capability_unknown: "Gateway capabilities unknown",
  capability_unsupported: "Gateway lacks required interface",
  remote_run_create_unknown: "Remote run dispatch unverified",
  remote_run_status_unknown: "Remote run status unknown",
  remote_run_interrupted: "Remote run interrupted",
  remote_run_stop_requested: "Stop requested",
  remote_run_stop_acknowledged: "Stop acknowledged",
  remote_run_stop_unknown: "Stop outcome unknown",
  approval_waiting: "Waiting for approval",
  approval_delivery_pending: "Approval delivery pending",
  approval_delivery_acknowledged: "Approval delivered",
  approval_delivery_failed: "Approval delivery failed",
  approval_expired: "Approval expired",
  provider_quota: "Provider quota reached",
  gateway_unavailable: "Gateway unavailable",
  protocol_incompatible: "Gateway protocol incompatible",
  fresh_continuation_unsupported: "Fresh continuation unavailable",
};

const RECONCILIATION_STATES = new Set([
  "remote_run_create_unknown",
  "remote_run_status_unknown",
  "remote_run_interrupted",
  "remote_run_stop_unknown",
]);

export function hermesRunFailureExplanation(run: {
  adapterType?: string | null;
  errorCode?: string | null;
  resultJson?: Record<string, unknown> | null;
}): HermesEvidenceExplanation | null {
  const evidence = evidenceFromRun(run);
  if (!evidence) return null;

  const label = EVIDENCE_LABELS[evidence.state] ?? "Gateway execution needs attention";
  const remoteRunId = evidence.remoteRunId;
  const remoteRunClause = remoteRunId
    ? ` Remote run ${remoteRunId} was created.`
    : " Whether a remote run was created is unknown; a lost response is not proof of non-dispatch.";

  if (RECONCILIATION_STATES.has(evidence.state)) {
    return {
      label,
      detail: `${label}.${remoteRunClause} The run must be reconciled against the gateway before this task can continue; it will not be replayed automatically.${evidence.reconciliationCondition ? ` Reconcile when: ${evidence.reconciliationCondition}.` : ""}${evidence.nextAction ? ` Next: ${evidence.nextAction}.` : ""}`,
      retryable: false,
    };
  }

  if (evidence.state === "capability_unsupported") {
    return {
      label,
      detail: `The configured gateway does not expose the required interface. Check the agent's capabilities, then create an upgrade task if the gateway must be extended.${evidence.nextAction ? ` Next: ${evidence.nextAction}.` : ""}`,
      retryable: false,
    };
  }

  if (evidence.state === "provider_quota") {
    return {
      label,
      detail: "The model provider has reached its current usage limit. This is a provider outcome, not a gateway reconciliation case. Try again after the limit resets.",
      retryable: true,
    };
  }

  if (evidence.state === "gateway_unavailable") {
    return {
      label,
      detail: `The Hermes API server could not be reached or rejected the request. Check the gateway process and the agent's apiBaseUrl/apiKey.${evidence.nextAction ? ` Next: ${evidence.nextAction}.` : ""}`,
      retryable: true,
    };
  }

  if (evidence.state === "remote_run_stop_requested" || evidence.state === "remote_run_stop_acknowledged") {
    return {
      label,
      detail: `${label}.${remoteRunClause} Acknowledgement of a stop is not proof that the run's effects completed.`,
      retryable: false,
    };
  }

  if (evidence.state === "fresh_continuation_unsupported") {
    return {
      label,
      detail: `This task cannot be continued with new instructions right now. The block is presented as-is; no continuation is implied.${evidence.reason ? ` Reason: ${evidence.reason}.` : ""}`,
      retryable: false,
    };
  }

  // Approval-family evidence states.
  return {
    label,
    detail: `${label}.${evidence.nextAction ? ` Next: ${evidence.nextAction}.` : ""}`,
    retryable: false,
  };
}
