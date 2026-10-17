
import { describe, expect, it } from "vitest";
import { hermesRunFailureExplanation } from "./hermes-evidence-explanation";

describe("hermesRunFailureExplanation", () => {
  it("returns null for non-hermes adapters", () => {
    expect(hermesRunFailureExplanation({ adapterType: "codex_local", errorCode: "adapter_failed", resultJson: { hermesEvidence: { state: "gateway_unavailable" } } })).toBeNull();
    expect(hermesRunFailureExplanation({ adapterType: "hermes_gateway", errorCode: "adapter_failed", resultJson: {} })).toBeNull();
  });

  it("explains a lost create response without implying non-dispatch", () => {
    const explanation = hermesRunFailureExplanation({
      adapterType: "hermes_gateway",
      errorCode: "hermes_gateway_connect_failed",
      resultJson: { hermesEvidence: { state: "remote_run_create_unknown", adapterErrorCode: "hermes_gateway_connect_failed" } },
    });
    expect(explanation?.label).toBe("Remote run dispatch unverified");
    expect(explanation?.retryable).toBe(false);
    expect(explanation?.detail).toMatch(/not proof of non-dispatch/);
    expect(explanation?.detail).toMatch(/reconcil/i);
  });

  it("mentions the remote run id when the dispatch fact is known", () => {
    const explanation = hermesRunFailureExplanation({
      adapterType: "hermes_gateway",
      errorCode: "hermes_gateway_timeout",
      resultJson: { hermesEvidence: { state: "remote_run_stop_unknown", remoteRunId: "hr-123", remoteRunCreated: true } },
    });
    expect(explanation?.detail).toContain("hr-123");
    expect(explanation?.retryable).toBe(false);
  });

  it("keeps stop acknowledgement from implying completed effects", () => {
    const explanation = hermesRunFailureExplanation({
      adapterType: "hermes_gateway",
      errorCode: "hermes_gateway_timeout",
      resultJson: { hermesEvidence: { state: "remote_run_stop_acknowledged", remoteRunId: "hr-9" } },
    });
    expect(explanation?.detail).toMatch(/not proof/);
  });

  it("treats provider quota as retryable and not a reconciliation case", () => {
    const explanation = hermesRunFailureExplanation({
      adapterType: "hermes_gateway",
      errorCode: "adapter_failed",
      resultJson: { hermesEvidence: { state: "provider_quota" } },
    });
    expect(explanation?.retryable).toBe(true);
    expect(explanation?.detail).toMatch(/not a gateway reconciliation case/);
  });

  it("explains fresh_continuation_unsupported without fabricating a continuation", () => {
    const explanation = hermesRunFailureExplanation({
      adapterType: "hermes_gateway",
      errorCode: null,
      resultJson: { hermesEvidence: { state: "fresh_continuation_unsupported", reason: "legacy run" } },
    });
    expect(explanation?.retryable).toBe(false);
    expect(explanation?.detail).toMatch(/no continuation is implied/i);
  });
});
