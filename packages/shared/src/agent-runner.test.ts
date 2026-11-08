import { describe, expect, it } from "vitest";
import { agentHarnessType, agentRuntimeSettingsHarness, pilibalaRunnerCreationLifecycle, pilibalaRunnerProfileForHarness } from "./agent-runner.js";

describe("Cursor Cloud harness identity", () => {
  it("retains its cloud identity across the explicit runner selection", () => {
    expect(pilibalaRunnerProfileForHarness("cursor_cloud")).toEqual({ provider: "cursor_cloud" });
    expect(agentHarnessType("pilibala_runner", { provider: "cursor_cloud" })).toBe("cursor_cloud");
    expect(agentRuntimeSettingsHarness("pilibala_runner", { provider: "cursor_cloud" })).toBe("cursor_cloud");
    expect(agentHarnessType("cursor_cloud")).toBe("cursor_cloud");
  });
});

describe("pilibalaRunnerCreationLifecycle", () => {
  it("stores no lifecycle for harnesses that follow the product default", () => {
    for (const harness of ["codex_local", "opencode_local", "claude_local"]) {
      expect(pilibalaRunnerCreationLifecycle(pilibalaRunnerProfileForHarness(harness)!)).toEqual({});
    }
  });

  it("keeps an explicit per_turn for other native harnesses", () => {
    for (const harness of ["pi_local", "grok_local", "cursor_cloud"]) {
      expect(pilibalaRunnerCreationLifecycle(pilibalaRunnerProfileForHarness(harness)!)).toEqual({ lifecycleMode: "per_turn" });
    }
  });
});
