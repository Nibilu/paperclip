import { z } from "zod";

/**
 * Hermes Gateway adapter-specific run evidence (SPEC-implementation 11.2 +
 * AMB-10 analysis). These are adapter-specific evidence states projected onto
 * Pilibala task/run/remote-run records. They are NOT Pilibala task statuses
 * and MUST NOT be confused with the generic run status or the recovery state
 * machine: the control plane keeps its own generic states and only consumes
 * this evidence for display, blockers, and admission explanations.
 *
 * Safety invariants (AGENTS.md):
 * - remote_run_stop_acknowledged is not proof the business effect completed;
 * - unknown-status / unknown-stop / interrupted MUST enter reconciliation;
 * - provider_quota MUST NOT be misread as a Hermes reconciliation case;
 * - fresh_continuation_unsupported only explains a block, never fabricates a
 *   continuation;
 * - no evidence value may unlock AMB-16/AMB-17 holds or replay an uncertain
 *   remote run.
 */

export const HERMES_RUN_EVIDENCE_STATES = [
  // Capability / protocol
  "capability_unknown",
  "capability_unsupported",
  // Remote run lifecycle
  "remote_run_create_unknown",
  "remote_run_status_unknown",
  "remote_run_interrupted",
  "remote_run_stop_requested",
  "remote_run_stop_acknowledged",
  "remote_run_stop_unknown",
  // Approval transport
  "approval_waiting",
  "approval_delivery_pending",
  "approval_delivery_acknowledged",
  "approval_delivery_failed",
  "approval_expired",
  // Provider outcome
  "provider_quota",
  "gateway_unavailable",
  "protocol_incompatible",
  "fresh_continuation_unsupported",
] as const;

export type HermesRunEvidenceState = (typeof HERMES_RUN_EVIDENCE_STATES)[number];

export const hermesRunEvidenceStateSchema = z.enum(HERMES_RUN_EVIDENCE_STATES);

/** The immutable facts a projection must preserve from the adapter. */
export const hermesRunEvidenceSchema = z
  .object({
    state: hermesRunEvidenceStateSchema,
    /** Adapter error code, e.g. hermes_gateway_connect_failed. */
    adapterErrorCode: z.string().optional(),
    /** Pilibala run id (never the same namespace as the remote run id). */
    runId: z.string().optional(),
    /** Hermes remote run id when known; absence is not proof of non-dispatch. */
    remoteRunId: z.string().optional(),
    /** Approval request id when the evidence concerns an approval. */
    approvalRequestId: z.string().optional(),
    /** Whether a remote run was definitely created (true only with a run id). */
    remoteRunCreated: z.boolean().optional(),
    /** Whether the gateway acknowledged a stop request. */
    stopAcknowledged: z.boolean().optional(),
    /** Whether a fresh continuation (new instructions) is available. */
    freshContinuationAvailable: z.boolean().optional(),
    /** Operator-facing explanation; must name the block and next action. */
    reason: z.string().optional(),
    /** What must happen before this evidence can clear. */
    reconciliationCondition: z.string().optional(),
    nextAction: z.string().optional(),
  })
  .strict();

export type HermesRunEvidence = z.infer<typeof hermesRunEvidenceSchema>;

/** Evidence states that force a reconciliation entry (never auto-retry). */
export const HERMES_RECONCILIATION_REQUIRED_STATES: ReadonlySet<HermesRunEvidenceState> = new Set([
  "remote_run_create_unknown",
  "remote_run_status_unknown",
  "remote_run_interrupted",
  "remote_run_stop_unknown",
]);

/** Evidence states that are display-only and must not gate admission. */
export const HERMES_DISPLAY_ONLY_STATES: ReadonlySet<HermesRunEvidenceState> = new Set([
  "remote_run_stop_requested",
  "remote_run_stop_acknowledged",
  "approval_delivery_pending",
  "approval_delivery_acknowledged",
  "approval_waiting",
]);

/**
 * Map a gateway adapter error code (+ resultJson evidence) to a run evidence
 * state. Pure function; the caller decides what to do with the state.
 */
export function hermesEvidenceStateFromAdapterError(
  errorCode: string | null | undefined,
  resultJson: Record<string, unknown> | null | undefined,
): HermesRunEvidenceState | null {
  const record = resultJson ?? {};
  const connectionFailure =
    typeof record.connectionFailure === "object" && record.connectionFailure !== null
      ? (record.connectionFailure as Record<string, unknown>)
      : null;

  switch (errorCode) {
    case "hermes_gateway_api_base_url_missing":
    case "hermes_gateway_api_base_url_invalid":
    case "hermes_gateway_api_key_missing":
    case "hermes_gateway_plain_http_remote_denied":
      return "capability_unknown";
    case "hermes_gateway_runs_unsupported":
      return "capability_unsupported";
    case "hermes_gateway_auth_failed":
      return "gateway_unavailable";
    case "hermes_gateway_rate_limited":
      // Rate limiting on the gateway transport, not a provider quota window.
      return "gateway_unavailable";
    case "hermes_gateway_upstream_error":
    case "hermes_gateway_connect_failed":
      // Lost response before a run id came back: dispatch fact unknown.
      return "remote_run_create_unknown";
    case "hermes_gateway_timeout":
      // A stop was requested but the final status may still be unknown.
      return record.run_id ? "remote_run_stop_unknown" : "remote_run_create_unknown";
    case "hermes_gateway_run_failed":
      // The remote run itself reported failure; this is a provider outcome,
      // not a gateway evidence gap.
      return null;
    default:
      void connectionFailure;
      return null;
  }
}

/**
 * Project a finished adapter execution result into run evidence. Returns null
 * when the result carries no Hermes-specific evidence worth projecting (the
 * generic control-plane states already describe it).
 */
export function projectHermesRunEvidence(input: {
  adapterType: string | null | undefined;
  errorCode: string | null | undefined;
  errorMeta?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
}): HermesRunEvidence | null {
  if (input.adapterType !== "hermes_gateway") return null;
  const resultJson = input.resultJson ?? null;
  const state = hermesEvidenceStateFromAdapterError(input.errorCode, resultJson);
  if (!state) return null;
  const remoteRunId =
    resultJson && typeof resultJson.run_id === "string" ? resultJson.run_id : undefined;
  return {
    state,
    ...(input.errorCode ? { adapterErrorCode: input.errorCode } : {}),
    ...(remoteRunId ? { remoteRunId, remoteRunCreated: true } : {}),
    reason: input.errorMeta
      ? undefined
      : undefined,
  };
}
