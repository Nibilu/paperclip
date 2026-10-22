import { describe, expect, it } from "vitest";
import { classifyRunFailure } from "./error-classification.js";

/**
 * Real failure samples from the 2026-10-22 incident (AMB-86/90/96/97, dev :3104)
 * plus representative non-hermes adapter failures. These are regression fixtures:
 * the classifier must slot each into the unified taxonomy so downstream recovery
 * (L0 retry vs L2 doctor delegation) can key off `category` instead of ad-hoc
 * regexes scattered through the recovery service.
 */

describe("classifyRunFailure - hermes lane incident samples", () => {
  it("AMB-90: hermes CLI resume policy refusal", () => {
    const result = classifyRunFailure({
      adapterType: "hermes_local",
      runtimeMode: "legacy",
      errorCode: "adapter_failed",
      exitCode: 2,
      errorMessage:
        "Error: Resume retains gateway session policy; creation overrides are unsupported on resume. --provider differs from this session's launch: resume without it and use /model after resuming to switch.",
    });
    expect(result.category).toBe("session_binding.resume_policy_refusal");
    expect(result.retryPolicy).toBe("never");
    expect(result.ladderHint).toBe("L2");
    expect(result.matchedSignals).toContain("hermes_resume_policy_provider_differs");
  });

  it("AMB-86/96: ACP adapter boot failure (missing acp module)", () => {
    const result = classifyRunFailure({
      adapterType: "hermes_local",
      runtimeMode: "legacy",
      errorCode: "adapter_failed",
      exitCode: 1,
      errorMessage: "Traceback (most recent call last):\nModuleNotFoundError: No module named 'acp'",
    });
    expect(result.category).toBe("runtime.adapter_boot_failure");
    expect(result.subcategory).toBe("python_missing_module");
    expect(result.retryPolicy).toBe("never");
    expect(result.ladderHint).toBe("L2");
    expect(result.matchedSignals).toContain("python_module_not_found");
  });

  it("AMB-96 variant: acpx session init failure code", () => {
    const result = classifyRunFailure({
      adapterType: "hermes_local",
      errorCode: "acpx_session_init_failed",
      errorMessage: "acpx: session init failed before first turn",
    });
    expect(result.category).toBe("runtime.adapter_boot_failure");
    expect(result.ladderHint).toBe("L2");
  });

  it("hermes gateway agent auth failure", () => {
    const result = classifyRunFailure({
      adapterType: "hermes_gateway",
      errorCode: "adapter_failed",
      errorMessage: "request failed: 401 Unauthorized from gateway endpoint",
    });
    expect(result.category).toBe("provider.auth");
    expect(result.retryPolicy).toBe("never");
  });
});

describe("classifyRunFailure - provider categories (custom gateway / local connections)", () => {
  it("quota/rate limit message maps to provider.limit", () => {
    const result = classifyRunFailure({
      errorCode: "adapter_failed",
      errorMessage: "Error: you've hit your usage limit. try again after 2026-10-22T12:00:00Z",
    });
    expect(result.category).toBe("provider.limit");
    expect(result.retryPolicy).toBe("wait_system");
    expect(result.ladderHint).toBe("L0");
  });

  it("429 status maps to provider.limit", () => {
    const result = classifyRunFailure({
      errorCode: "adapter_failed",
      errorMessage: "provider request failed",
      providerStatus: 429,
    });
    expect(result.category).toBe("provider.limit");
    expect(result.retryPolicy).toBe("wait_system");
  });

  it("401/403 map to provider.auth and never auto-retry", () => {
    for (const status of [401, 403]) {
      const result = classifyRunFailure({ errorCode: "adapter_failed", providerStatus: status });
      expect(result.category).toBe("provider.auth");
      expect(result.retryPolicy).toBe("never");
    }
  });

  it("connection failures map to provider.connection with bounded retry", () => {
    for (const message of [
      "Error: connect ECONNREFUSED 127.0.0.1:8080",
      "TypeError: fetch failed",
      "Error: socket hang up",
    ]) {
      const result = classifyRunFailure({ errorCode: "adapter_failed", errorMessage: message });
      expect(result.category).toBe("provider.connection");
      expect(result.retryPolicy).toBe("bounded");
    }
  });
});

describe("classifyRunFailure - established errorCodes pass through", () => {
  it("server_shutdown_interrupted stays infra with bounded retry", () => {
    const result = classifyRunFailure({ errorCode: "server_shutdown_interrupted" });
    expect(result.category).toBe("infra.server_shutdown");
    expect(result.retryPolicy).toBe("bounded");
    expect(result.ladderHint).toBe("L0");
  });

  it("process_lost stays runtime.process_lost", () => {
    const result = classifyRunFailure({ errorCode: "process_lost" });
    expect(result.category).toBe("runtime.process_lost");
  });

  it("workspace validation keeps its reason code", () => {
    const result = classifyRunFailure({
      errorCode: "workspace_validation_failed",
      resultJson: { workspaceValidation: { reason: "git_worktree_not_reusable", reasonCode: "git_inspection_failed" } },
    });
    expect(result.category).toBe("workspace.validation_failed");
    expect(result.subcategory).toBe("git_worktree_not_reusable");
  });

  it("configuration incomplete keeps its reason code", () => {
    const result = classifyRunFailure({
      errorCode: "configuration_incomplete",
      resultJson: { configurationIncomplete: { reason: "workspace_base_ref_unresolved" } },
    });
    expect(result.category).toBe("workspace.configuration_incomplete");
  });

  it("native provider terminal failure classifies via provider taxonomy", () => {
    const result = classifyRunFailure({
      errorCode: "native_provider_terminal_failed",
      resultJson: { terminalSessionFailure: { category: "access" } },
    });
    expect(result.category).toBe("provider.auth");
  });

  it("unknown adapter failures stay unknown but reachable by the doctor ladder", () => {
    const result = classifyRunFailure({
      adapterType: "codex_local",
      errorCode: "adapter_failed",
      errorMessage: "codex exited with code 1",
    });
    expect(result.category).toBe("unknown");
    expect(result.ladderHint).toBe("L2");
  });

  it("empty input degrades to unknown", () => {
    expect(classifyRunFailure({})).toMatchObject({ category: "unknown", retryPolicy: "never", ladderHint: "L2" });
  });
});

describe("classifyRunFailure - rule precedence", () => {
  it("boot failure wins over provider when both signals appear (AMB-96 regression)", () => {
    // The incident stderr mentioned the provider endpoint too; the boot failure
    // is the root cause and must classify first.
    const result = classifyRunFailure({
      adapterType: "hermes_local",
      errorCode: "adapter_failed",
      exitCode: 1,
      errorMessage:
        "ModuleNotFoundError: No module named 'acp'\nerror: request to https://integrate.api.nvidia.com failed: 429",
    });
    expect(result.category).toBe("runtime.adapter_boot_failure");
  });

  it("resume refusal wins over provider signals (AMB-90 regression)", () => {
    const result = classifyRunFailure({
      adapterType: "hermes_local",
      errorCode: "adapter_failed",
      exitCode: 2,
      errorMessage:
        "Resume retains gateway session policy; --provider differs from this session's launch (nvidia, 429-prone provider).",
    });
    expect(result.category).toBe("session_binding.resume_policy_refusal");
  });

  it("acp session config mismatch classifies as boot failure (AMB-99 live regression)", () => {
    const byCode = classifyRunFailure({
      adapterType: "hermes_local",
      errorCode: "acpx_session_config_failed",
      errorMessage:
        "ACP session paperclip:c1:04a:fb does not advertise config option 'model'. Supported config options: none.",
    });
    expect(byCode).toMatchObject({
      category: "runtime.adapter_boot_failure",
      subcategory: "acp_session_config_mismatch",
      retryPolicy: "never",
      ladderHint: "L2",
    });
    // Message-only shape (errorCode withheld upstream) still matches.
    const byMessage = classifyRunFailure({
      adapterType: "hermes_local",
      errorCode: "adapter_failed",
      errorMessage:
        "ACP session paperclip:c1:04a:fb does not advertise config option 'model'. Supported config options: none.",
    });
    expect(byMessage.category).toBe("runtime.adapter_boot_failure");
  });
});
