import { describe, expect, it } from "vitest";
import { pilibalaRunnerTransitionConfig } from "./pilibala-runner-permissions.js";
import { normalizePilibalaRunnerAdapterConfig } from "./server-utils.js";

const normalize = (config: Record<string, unknown>) => normalizePilibalaRunnerAdapterConfig("pilibala_runner", config);

describe("native runner lifecycle default on configuration writes", () => {
  it("stores no lifecycle for providers that follow the product default", () => {
    for (const config of [{ provider: "codex" }, { provider: "opencode", model: "openrouter/m" }, { provider: "acpx", acpxAgent: "claude" }, {}]) {
      // An empty config defaults to native Codex.
      expect(normalize(config)).not.toHaveProperty("lifecycleMode");
    }
  });

  it("keeps an explicit per_turn for other native providers", () => {
    for (const config of [{ provider: "acpx", acpxAgent: "grok" }, { provider: "acpx", acpxAgent: "pi" }, { provider: "cursor_cloud" }]) {
      expect(normalize(config)).toMatchObject({ lifecycleMode: "per_turn" });
    }
  });

  it("preserves an explicit choice", () => {
    expect(normalize({ provider: "codex", lifecycleMode: "per_turn" })).toMatchObject({ lifecycleMode: "per_turn" });
    expect(normalize({ provider: "opencode", model: "openrouter/m", lifecycleMode: "warm", idleTimeoutMs: 900_000 }))
      .toMatchObject({ lifecycleMode: "warm", idleTimeoutMs: 900_000 });
  });

  it("converts a local adapter without pinning the lifecycle for default providers", () => {
    expect(pilibalaRunnerTransitionConfig("codex_local", "gpt-5")).not.toHaveProperty("lifecycleMode");
    expect(pilibalaRunnerTransitionConfig("opencode_local", "openrouter/m")).not.toHaveProperty("lifecycleMode");
    expect(pilibalaRunnerTransitionConfig("claude_local", undefined)).not.toHaveProperty("lifecycleMode");
    expect(pilibalaRunnerTransitionConfig("grok_local", undefined)).toMatchObject({ lifecycleMode: "per_turn" });
    expect(pilibalaRunnerTransitionConfig("cursor_cloud", "m")).toMatchObject({ lifecycleMode: "per_turn" });
  });
});
