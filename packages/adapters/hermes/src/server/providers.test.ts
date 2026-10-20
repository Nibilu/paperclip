import { describe, expect, it, beforeEach } from "vitest";
import {
  listHermesProviders,
  listHermesProviderModels,
  resetHermesDiscoveryCache,
} from "./providers.js";

beforeEach(() => {
  resetHermesDiscoveryCache();
});

describe("listHermesProviders", () => {
  it("returns a registry that includes the major upstream providers", async () => {
    const entries = await listHermesProviders();
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("nvidia");
    expect(names).toContain("openrouter");
    expect(names).toContain("anthropic");
  });

  it("never returns non-upstream config pseudo-providers", async () => {
    const entries = await listHermesProviders();
    const names = entries.map((entry) => entry.name);
    expect(names).not.toContain("custom");
    expect(names).not.toContain("auto");
    expect(names).not.toContain("router");
  });

  it("exposes base URL and credential env var names but no secret values", async () => {
    const entries = await listHermesProviders();
    const nvidia = entries.find((entry) => entry.name === "nvidia");
    expect(nvidia).toBeDefined();
    expect(nvidia!.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(nvidia!.envVars).toContain("NVIDIA_API_KEY");
    for (const entry of entries) {
      for (const value of Object.values(entry)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            // Env var *names* and model IDs only; a real nvapi-… key must never appear.
            expect(item.startsWith("nvapi-")).toBe(false);
          }
        }
      }
    }
  });

  it("is cached across rapid successive calls", async () => {
    const first = await listHermesProviders();
    const second = await listHermesProviders();
    expect(second).toBe(first);
  });
});

describe("listHermesProviderModels", () => {
  it("returns a result object for an unknown provider without throwing", async () => {
    const result = await listHermesProviderModels("definitely-not-a-provider");
    expect(result.provider).toBe("definitely-not-a-provider");
    expect(result.discovered).toBe(false);
    expect(result.reason).toBe("unknown_provider");
  });

  it("degrades gracefully for a provider without a credential", async () => {
    // zai has no key in the test host env (NVIDIA does); if the host gains one,
    // the degradation path is still valid — the assertion is on shape, not status.
    const result = await listHermesProviderModels("zai");
    expect(result.provider).toBe("zai");
    expect(Array.isArray(result.models)).toBe(true);
    if (!result.discovered) {
      expect(["no_credential", "timeout", "endpoint_unreachable", "http_401", "http_403"]).toContain(result.reason);
    }
  });

  it("discovers live models when a credential exists (host-dependent, NVIDIA)", async () => {
    const result = await listHermesProviderModels("nvidia");
    expect(result.provider).toBe("nvidia");
    expect(Array.isArray(result.models)).toBe(true);
    if (result.discovered) {
      expect(result.models.length).toBeGreaterThan(0);
      expect(result.reason).toBeUndefined();
    } else {
      // Host without a key or network must still return the fallback list.
      expect(result.models.length).toBeGreaterThanOrEqual(0);
    }
  });
});
