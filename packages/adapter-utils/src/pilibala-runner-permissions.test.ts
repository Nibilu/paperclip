import { resolvePilibalaRunnerPiThinkingLevel } from "./pilibala-runner-permissions.js";
import { describe, expect, it } from "vitest";

import {
  PILIBALA_RUNNER_DEFAULT_MODELS,
  PILIBALA_RUNNER_ACPX_PROFILES,
  pilibalaRunnerTransitionConfig,
  isPilibalaRunnerProvider,
  resolvePilibalaRunnerModel,
  resolvePilibalaRunnerPermissionMode,
  resolvePilibalaRunnerCursorMode,
} from "./pilibala-runner-permissions.js";

describe("Pilibala Runner permission defaults", () => {
  it("exposes qualified Kimi Code with an explicit runtime credential", () => {
    expect(PILIBALA_RUNNER_ACPX_PROFILES.find(profile => profile.value === "kimi"))
      .toMatchObject({ qualified: true, credentialEnvironment: ["KIMI_API_KEY"] });
  });
  it("marks Pi and Copilot qualified with their provider credential bindings", () => {
    expect(PILIBALA_RUNNER_ACPX_PROFILES.find(profile => profile.value === "pi"))
      .toMatchObject({ qualified: true, credentialEnvironment: expect.arrayContaining(["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) });
    expect(PILIBALA_RUNNER_ACPX_PROFILES.find(profile => profile.value === "copilot"))
      .toMatchObject({ qualified: true, credentialEnvironment: ["COPILOT_GITHUB_TOKEN"] });
  });
  it("defaults Codex to the only qualified non-interactive mode", () => {
    expect(resolvePilibalaRunnerPermissionMode("codex", undefined)).toBe(
      "never",
    );
    expect(resolvePilibalaRunnerPermissionMode("codex", "on-request")).toBe("never");
    expect(resolvePilibalaRunnerPermissionMode("codex", "untrusted")).toBe("never");
  });

  it("defaults Claude and OpenCode to full auto", () => {
    expect(resolvePilibalaRunnerPermissionMode("opencode", undefined)).toBe(
      "allow",
    );
    expect(resolvePilibalaRunnerPermissionMode("acpx", undefined)).toBe(
      "approve-all",
    );
  });

  it.each(["approve-pilibala", "approve-reads", "deny-all", "approve-all"])("preserves explicit Claude %s settings", (mode) => {
    expect(resolvePilibalaRunnerPermissionMode("acpx", mode)).toBe(mode);
  });

  it.each([
    ["claude_local", "acpxPermissionMode", "approve-all"],
    ["codex_local", "codexPermissionMode", "never"],
    ["opencode_local", "opencodePermissionMode", "allow"],
    ["pi_local", "acpxPermissionMode", "approve-all"],
    ["grok_local", "acpxPermissionMode", "approve-all"],
  ])("uses full auto when converting %s to the new runner", (adapter, key, value) => {
    expect(pilibalaRunnerTransitionConfig(adapter, undefined)).toMatchObject({ [key]: value });
  });

  it("keeps Pi models explicit during conversion", () => {
    expect(pilibalaRunnerTransitionConfig("pi_local", undefined)).toMatchObject({ provider: "acpx", acpxAgent: "pi", model: "" });
    expect(pilibalaRunnerTransitionConfig("pi_local", "openrouter/provider/model")).toMatchObject({ provider: "acpx", acpxAgent: "pi", model: "openrouter/provider/model" });
  });

  it("keeps Grok's harness and model when converting its adapter", () => {
    expect(pilibalaRunnerTransitionConfig("grok_local", "grok-4.7"))
      .toMatchObject({ provider: "acpx", acpxAgent: "grok", model: "grok-4.7" });
  });

  it.each([undefined, "", "grok-build"])("resolves Grok's legacy default %s to the native model", model => {
    expect(pilibalaRunnerTransitionConfig("grok_local", model)).toMatchObject({ model: "grok-4.7" });
  });

  it("recognizes only exact provider identifiers", () => {
    expect(isPilibalaRunnerProvider("cursor_cloud")).toBe(true);
    expect(isPilibalaRunnerProvider("codex")).toBe(true);
    expect(isPilibalaRunnerProvider("opencode")).toBe(true);
    expect(isPilibalaRunnerProvider("claude_managed")).toBe(true);
    expect(isPilibalaRunnerProvider("aws_agentcore")).toBe(true);
    expect(isPilibalaRunnerProvider("acpx")).toBe(true);
    expect(isPilibalaRunnerProvider("toString")).toBe(false);
    expect(isPilibalaRunnerProvider("__proto__")).toBe(false);
  });

  it("keeps managed provider permissions under the qualified profile", () => {
    expect(resolvePilibalaRunnerPermissionMode("cursor_cloud", "never")).toBe("provider-managed");
    expect(resolvePilibalaRunnerPermissionMode("claude_managed", "never"))
      .toBe("provider-managed");
    expect(resolvePilibalaRunnerPermissionMode("aws_agentcore", "approve-all"))
      .toBe("provider-managed");
  });

  it("converts Cursor Cloud without substituting an implicit model or adding command permission controls", () => {
    expect(pilibalaRunnerTransitionConfig("cursor_cloud", "custom-model")).toEqual({ provider: "cursor_cloud", model: "custom-model", lifecycleMode: "per_turn" });
    expect(pilibalaRunnerTransitionConfig("cursor_cloud", undefined)).toEqual({ provider: "cursor_cloud", model: "", lifecycleMode: "per_turn" });
  });

  it("uses the Codex default for missing or blank models", () => {
    expect(resolvePilibalaRunnerModel("codex", undefined)).toBe(
      PILIBALA_RUNNER_DEFAULT_MODELS.codex,
    );
    expect(resolvePilibalaRunnerModel("codex", "   ")).toBe(
      PILIBALA_RUNNER_DEFAULT_MODELS.codex,
    );
  });

  it("preserves an explicit Codex model", () => {
    expect(resolvePilibalaRunnerModel("codex", "gpt-5.5")).toBe("gpt-5.5");
    expect(resolvePilibalaRunnerModel("codex", "  gpt-5.5  ")).toBe("gpt-5.5");
  });
});


describe("Cursor session mode admission", () => {
  it.each([undefined, "agent", "plan", "ask"])("retains mode %s with an explicit Cursor default", mode => {
    expect(resolvePilibalaRunnerCursorMode("acpx", "cursor", mode)).toBe(mode ?? "agent");
  });
  it.each([null, "", "auto", "PLAN", true, {}, ["plan"]])("rejects invalid mode %j", mode => {
    expect(() => resolvePilibalaRunnerCursorMode("acpx", "cursor", mode)).toThrow("Cursor session mode");
  });
  it.each([["codex", "cursor"], ["acpx", "copilot"], ["acpx", "pi"], ["acpx", "claude"]])("rejects mode on %s/%s", (provider, agent) => {
    expect(resolvePilibalaRunnerCursorMode(provider, agent, undefined)).toBeUndefined();
    expect(() => resolvePilibalaRunnerCursorMode(provider, agent, "plan")).toThrow("only for Cursor");
  });
});

describe("Pi thinking configuration", () => {
  it.each([undefined, "off", "low", "high", "max"] as const)("persists exact level %s with low as the fresh-config default", value => {
    expect(resolvePilibalaRunnerPiThinkingLevel("acpx", "pi", value)).toBe(value ?? "low");
  });
  it.each(["medium", "minimal", "xhigh", "", null, 1])("rejects unsupported alias %s", value => {
    expect(() => resolvePilibalaRunnerPiThinkingLevel("acpx", "pi", value)).toThrow();
  });
  it("rejects foreign provider settings", () => {
    expect(() => resolvePilibalaRunnerPiThinkingLevel("codex", "pi", "low")).toThrow(/only/);
    expect(() => resolvePilibalaRunnerPiThinkingLevel("acpx", "cursor", "low")).toThrow(/only/);
    expect(resolvePilibalaRunnerPiThinkingLevel("codex", undefined, undefined)).toBeUndefined();
  });
});
