import { describe, expect, test } from "vitest";

import { validateHermesAdapterConfig } from "./model-pair.js";

const nvidiaCatalog = {
  provider: "nvidia",
  models: ["deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"],
  discovered: true,
};

function depsWith(overrides: {
  entries?: Array<{ name: string }>;
  models?: { provider: string; models: string[]; discovered: boolean; reason?: string };
}) {
  return {
    listProviders: async () => overrides.entries ?? [{ name: "nvidia" }, { name: "proxy-router" }],
    listProviderModels: async (provider: string) =>
      overrides.models ?? { ...nvidiaCatalog, provider },
  };
}

describe("validateHermesAdapterConfig (provider↔model live pair guard)", () => {
  test("accepts a pair the live catalog serves", async () => {
    await expect(
      validateHermesAdapterConfig(
        { provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" },
        depsWith({}),
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects a model the provider's live catalog does not serve", async () => {
    await expect(
      validateHermesAdapterConfig(
        { provider: "nvidia", model: "deepseek-ai/deepseek-coder-6.7b-instruct" },
        depsWith({}),
      ),
    ).rejects.toThrow(/not served by provider "nvidia".*live catalog/);
  });

  test("rejects a provider the registry positively does not know", async () => {
    await expect(
      validateHermesAdapterConfig(
        { provider: "nvidai", model: "deepseek-ai/deepseek-v4.1-flash" },
        depsWith({}),
      ),
    ).rejects.toThrow(/Unknown model provider "nvidai"/);
  });

  test("degrades open when discovery cannot verify (no credential / timeout / http error)", async () => {
    for (const reason of ["no_credential", "timeout", "http_429", "endpoint_unreachable", "empty_catalog"]) {
      await expect(
        validateHermesAdapterConfig(
          { provider: "nvidia", model: "deepseek-ai/deepseek-v4.1-flash" },
          depsWith({ models: { provider: "nvidia", models: [], discovered: false, reason } }),
        ),
      ).resolves.toBeUndefined();
    }
  });

  test("degrades open when the provider registry itself failed to read (empty entries + failed discovery)", async () => {
    // Both truth sources unavailable → nothing positive to reject on.
    await expect(
      validateHermesAdapterConfig(
        { provider: "nvidia", model: "anything" },
        depsWith({ entries: [], models: { provider: "nvidia", models: [], discovered: false, reason: "endpoint_unreachable" } }),
      ),
    ).resolves.toBeUndefined();
    // But a live catalog is positive evidence even with a broken registry.
    await expect(
      validateHermesAdapterConfig(
        { provider: "nvidia", model: "anything" },
        depsWith({ entries: [] }),
      ),
    ).rejects.toThrow(/not served by provider "nvidia"/);
  });

  test("model-only / provider-only / auto configs are not a pair — no-op (host-default path stays legal)", async () => {
    for (const config of [
      { model: "deepseek-ai/deepseek-v4.1-flash" },
      { provider: "nvidia" },
      { provider: "auto", model: "anything" },
      {},
    ]) {
      await expect(validateHermesAdapterConfig(config, depsWith({}))).resolves.toBeUndefined();
    }
  });
});
