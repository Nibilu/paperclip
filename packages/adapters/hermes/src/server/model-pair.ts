/**
 * Provider↔model pair guard at the persistence boundary.
 *
 * Truth hierarchy for "which provider serves which model":
 * 1. The provider's LIVE model catalog, requested through the adapter's
 *    base_url with the protocol-appropriate auth (openai-compatible Bearer,
 *    anthropic x-api-key, ...) — `providers.ts` discovery.
 * 2. The user's explicit (provider, model) pair in adapterConfig.
 *
 * Static sources are NOT truth and must never gate a pair:
 * - `~/.hermes/config.yaml` `model:` is a bootstrap default; effective state
 *   lives in Hermes's session DB and auth.json credential pool.
 * - `custom_providers.models` are cached discovery snapshots (stale).
 * - Model-name prefix hints conflate vendor namespaces with provider identity
 *   (`deepseek-ai/*` is served by NVIDIA NIM and by any router alike).
 *
 * Semantics: reject ONLY on positive mismatch evidence (the provider's live
 * catalog explicitly excludes the model, or the registry positively does not
 * know the provider). Discovery degradation (no credential, timeout, HTTP
 * error, empty catalog) degrades OPEN — availability never depends on
 * discovery succeeding.
 */

export interface HermesProviderEntryLike {
  name: string;
}

export interface HermesModelListResultLike {
  provider: string;
  models: string[];
  discovered: boolean;
  reason?: string;
}

export interface HermesModelPairDeps {
  listProviders?: () => Promise<HermesProviderEntryLike[]>;
  listProviderModels?: (provider: string) => Promise<HermesModelListResultLike>;
}

function configString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function validateHermesAdapterConfig(
  config: Record<string, unknown>,
  deps: HermesModelPairDeps = {},
): Promise<void> {
  const provider = configString(config.provider);
  const model = configString(config.model);
  // A pair is only enforceable when BOTH sides are explicit. Model-only (or
  // provider-only) configs delegate to Hermes's own native resolution of its
  // host default — Pilibala must not guess, and must not block the
  // "Default (Hermes config)" setup path.
  if (!provider || !model || provider === "auto") return;

  const listProviders = deps.listProviders ?? (async () => {
    const { listHermesProviders } = await import("./providers.js");
    return listHermesProviders();
  });
  const listProviderModels = deps.listProviderModels ?? (async (p: string) => {
    const { listHermesProviderModels } = await import("./providers.js");
    return listHermesProviderModels(p);
  });

  const entries = await listProviders().catch(() => [] as HermesProviderEntryLike[]);
  if (entries.length > 0 && !entries.some((entry) => entry.name === provider)) {
    throw new Error(
      `Unknown model provider "${provider}". Pick a provider from the setup catalog — Pilibala keeps the provider/model pair validated end to end.`,
    );
  }

  const result = await listProviderModels(provider).catch(() => null);
  if (!result || !result.discovered) return; // degrade open (no credential / timeout / http error / empty catalog)
  if (!result.models.includes(model)) {
    throw new Error(
      `Model "${model}" is not served by provider "${provider}" (live catalog, ${result.models.length} models). Re-select the model for this provider — switching the model must keep the current provider.`,
    );
  }
}
