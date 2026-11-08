import { describe, expect, it } from "vitest";
import { projectPilibalaRunnerTaskConfig, resolvePilibalaRunnerNativeProviderInput, resolvePilibalaRunnerProviderProfile } from "./provider-profile.js";

const config = { provider: "cursor_cloud", model: "caller-custom-model", repoUrl: "https://github.com/acme/repo", env: { CURSOR_API_KEY: { type: "secret_ref", secretId: "company-secret", version: "latest" } } };

describe("Cursor Cloud native provider admission", () => {
  it("forwards the task-selected exact model without applying an effort policy", () => {
    const projected = projectPilibalaRunnerTaskConfig("cursor_cloud_api", config, { model: "task-selected-model", modelReasoningEffort: "high" });
    expect(resolvePilibalaRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: projected })).toMatchObject({ model: "task-selected-model" });
    expect(projected).not.toHaveProperty("modelReasoningEffort");
  });
  it("preserves the exact caller model and provider-owned remote configuration", () => {
    expect(resolvePilibalaRunnerProviderProfile(config)).toEqual({ provider: "cursor_cloud", backend: "cursor_cloud_api", model: "caller-custom-model" });
    expect(resolvePilibalaRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: { ...config, repoRef: "feature", autoCreatePR: true } })).toEqual({
      provider: "cursor_cloud", model: "caller-custom-model", cursorCloud: { schema: "pilibala.cursor-cloud.config.v1", repos: [{ url: config.repoUrl, startingRef: "feature" }], env: { type: "cloud" }, autoCreatePR: true },
    });
  });

  it("reads saved legacy repository fields and rejects conflicting aliases", () => {
    expect(resolvePilibalaRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: { ...config, repoStartingRef: "legacy", runtimeEnvType: "cloud" } })).toMatchObject({ cursorCloud: { repos: [{ startingRef: "legacy" }] } });
    expect(() => resolvePilibalaRunnerProviderProfile({ ...config, repoStartingRef: "legacy", repoRef: "different" })).toThrow(expect.objectContaining({ code: "pilibala_runner_cursor_cloud_config_invalid" }));
  });

  it.each(["plain", "secret_ref"])("rejects selected hosted secrets instead of dropping their %s binding", type => {
    const env = { ...config.env, GH_TOKEN: type === "plain" ? { type, value: "unforwarded-test-value" } : { type, secretId: "hosted-secret", version: "latest" } };
    for (const admit of [
      () => resolvePilibalaRunnerProviderProfile({ ...config, env }),
      () => resolvePilibalaRunnerNativeProviderInput({ backend: "cursor_cloud_api", adapterConfig: { ...config, env } }),
    ]) {
      expect(admit).toThrow("Configure hosted secrets in your Cursor Cloud environment");
      expect(admit).toThrow("GH_TOKEN");
      expect(admit).not.toThrow("unforwarded-test-value");
    }
  });

  it.each(["", undefined])("requires an explicit model (%s)", model => {
    expect(() => resolvePilibalaRunnerProviderProfile({ ...config, model })).toThrow(expect.objectContaining({ code: "pilibala_runner_cursor_cloud_model_required" }));
  });

  it.each([
    { cloudEnvType: "pool" }, { lifecycleMode: "warm" }, { codexPermissionMode: "never" },
    { acpxPermissionMode: "approve-all" }, { promptTemplate: "replace assigned instructions" },
    { modelReasoningEffort: "high" }, { reasoningEffort: "high" }, { effort: "high" }, { modelParams: [{ key: "reasoning", value: "high" }] }, { homeMode: "preconfigured" },
    { cursorCloudTimeoutMs: 3_600_001 }, { repoUrl: "https://user:secret@github.com/acme/repo" },
  ])("rejects unsupported or unsafe configuration %j", patch => {
    expect(() => resolvePilibalaRunnerProviderProfile({ ...config, ...patch })).toThrow(expect.objectContaining({ code: "pilibala_runner_cursor_cloud_config_invalid" }));
  });
});
