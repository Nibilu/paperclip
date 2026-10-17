import { describe, expect, it } from "vitest";
import {
  HERMES_DISPLAY_ONLY_STATES,
  HERMES_RECONCILIATION_REQUIRED_STATES,
  HERMES_RUN_EVIDENCE_STATES,
  hermesRunEvidenceSchema,
  hermesEvidenceStateFromAdapterError,
  projectHermesRunEvidence,
} from "./hermes-run-evidence.js";

describe("hermes run evidence states", () => {
  it("exposes the 17 AMB-10 states", () => {
    expect(HERMES_RUN_EVIDENCE_STATES).toHaveLength(17);
  });

  it("routes unknown dispatch facts to reconciliation, never display-only", () => {
    for (const state of ["remote_run_create_unknown", "remote_run_status_unknown", "remote_run_interrupted", "remote_run_stop_unknown"]) {
      expect(HERMES_RECONCILIATION_REQUIRED_STATES.has(state as never)).toBe(true);
      expect(HERMES_DISPLAY_ONLY_STATES.has(state as never)).toBe(false);
    }
  });

  it("keeps stop acknowledgement display-only (not proof of completed effect)", () => {
    expect(HERMES_DISPLAY_ONLY_STATES.has("remote_run_stop_acknowledged")).toBe(true);
    expect(HERMES_RECONCILIATION_REQUIRED_STATES.has("remote_run_stop_acknowledged")).toBe(false);
  });

  it("keeps provider_quota out of the reconciliation set", () => {
    expect(HERMES_RECONCILIATION_REQUIRED_STATES.has("provider_quota")).toBe(false);
  });
});

describe("hermesEvidenceStateFromAdapterError", () => {
  it("maps configuration errors to capability_unknown", () => {
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_api_key_missing", null)).toBe("capability_unknown");
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_plain_http_remote_denied", null)).toBe("capability_unknown");
  });

  it("maps runs_unsupported to capability_unsupported", () => {
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_runs_unsupported", null)).toBe("capability_unsupported");
  });

  it("maps a lost create response to remote_run_create_unknown", () => {
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_connect_failed", null)).toBe("remote_run_create_unknown");
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_upstream_error", null)).toBe("remote_run_create_unknown");
  });

  it("maps timeout with a known remote run to stop_unknown", () => {
    expect(
      hermesEvidenceStateFromAdapterError("hermes_gateway_timeout", { run_id: "hr-123", status: "timeout" }),
    ).toBe("remote_run_stop_unknown");
  });

  it("maps timeout without a remote run to create_unknown (lost dispatch fact)", () => {
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_timeout", null)).toBe("remote_run_create_unknown");
  });

  it("returns null for provider outcomes the generic state machine already covers", () => {
    expect(hermesEvidenceStateFromAdapterError("hermes_gateway_run_failed", null)).toBeNull();
    expect(hermesEvidenceStateFromAdapterError(null, null)).toBeNull();
  });
});

describe("projectHermesRunEvidence", () => {
  it("ignores non-hermes adapters", () => {
    expect(
      projectHermesRunEvidence({ adapterType: "codex_local", errorCode: "hermes_gateway_connect_failed", resultJson: null }),
    ).toBeNull();
  });

  it("preserves the remote run id and created fact when present", () => {
    const evidence = projectHermesRunEvidence({
      adapterType: "hermes_gateway",
      errorCode: "hermes_gateway_timeout",
      resultJson: { run_id: "hr-123", status: "timeout" },
    });
    expect(evidence?.state).toBe("remote_run_stop_unknown");
    expect(evidence?.remoteRunId).toBe("hr-123");
    expect(evidence?.remoteRunCreated).toBe(true);
  });

  it("validates against the evidence schema", () => {
    const evidence = projectHermesRunEvidence({
      adapterType: "hermes_gateway",
      errorCode: "hermes_gateway_connect_failed",
      resultJson: null,
    });
    expect(hermesRunEvidenceSchema.safeParse(evidence).success).toBe(true);
  });
});
