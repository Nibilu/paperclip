/**
 * Detect the current model and provider from the user's Hermes config.
 *
 * Reads ~/.hermes/config.yaml and extracts the default model,
 * provider, base_url, api_key presence, and api_mode settings.
 *
 * Also provides provider resolution logic that merges explicit config,
 * Hermes config detection, and model-name prefix inference.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { MODEL_PREFIX_PROVIDER_HINTS, VALID_PROVIDERS } from "../shared/constants.js";

export interface DetectedModel {
  /** Model name from config (e.g. "gpt-5.4", "anthropic/claude-sonnet-4") */
  model: string;
  /** Provider name from config (e.g. "copilot", "zai"). May be empty. */
  provider: string;
  /** Base URL override from config (e.g. "https://api.githubcopilot.com"). May be empty. */
  baseUrl: string;
  /** Whether Hermes config includes a non-empty API key. */
  hasApiKey: boolean;
  /** API mode from config (e.g. "chat_completions", "codex_responses"). May be empty. */
  apiMode: string;
  /** Where the detection came from */
  source: "config";
}

/**
 * Read the Hermes config file and extract the default model config.
 */
export async function detectModel(
  configPath?: string,
): Promise<DetectedModel | null> {
  const filePath = configPath ?? join(homedir(), ".hermes", "config.yaml");

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  return parseModelFromConfig(content);
}

/**
 * Parse model.default, model.provider, model.base_url, model.api_key, and model.api_mode
 * from raw YAML content. Uses simple regex parsing to avoid a YAML dependency.
 */
export function parseModelFromConfig(content: string): DetectedModel | null {
  const lines = content.split("\n");
  let model = "";
  let provider = "";
  let baseUrl = "";
  let hasApiKey = false;
  let apiMode = "";
  let inModelSection = false;
  let modelSectionIndent = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;

    // Track model: section (indent 0)
    if (/^model:\s*$/.test(trimmed) && indent === 0) {
      inModelSection = true;
      modelSectionIndent = 0;
      continue;
    }

    // We left the model section if indent drops back to the section level or below
    if (inModelSection && indent <= modelSectionIndent && trimmed && !trimmed.startsWith("#")) {
      inModelSection = false;
    }

    if (inModelSection) {
      const match = trimmed.match(/^\s*(\w+)\s*:\s*(.+)$/);
      if (match) {
        const key = match[1];
        const val = match[2].trim().replace(/#.*$/, "").trim().replace(/^['"]|['"]$/g, "");
        if (key === "default") model = val;
        if (key === "provider") provider = val;
        if (key === "base_url") baseUrl = val;
        if (key === "api_key") hasApiKey = val.length > 0;
        if (key === "api_mode") apiMode = val;
      }
    }
  }

  if (!model) return null;

  return { model, provider, baseUrl, hasApiKey, apiMode, source: "config" };
}

/**
 * Infer a provider from the model name using prefix-based hints.
 *
 * For example:
 *   "gpt-5.4"       → "copilot"
 *   "claude-sonnet-4" → "anthropic"
 *   "glm-5-turbo"   → "zai"
 *
 * Returns undefined if no hint matches (caller should fall back to "auto").
 */
export function inferProviderFromModel(model: string): string | undefined {
  const lower = model.toLowerCase();

  // Strip provider/ prefix if present (e.g. "anthropic/claude-sonnet-4")
  const bareName = lower.includes("/") ? lower.split("/").pop()! : lower;

  for (const [prefix, hint] of MODEL_PREFIX_PROVIDER_HINTS) {
    if (bareName.startsWith(prefix)) {
      return hint;
    }
  }

  return undefined;
}

/**
 * Resolve the correct provider for a model, using a priority chain:
 *
 *   1. Explicit provider from adapterConfig (highest priority — user override)
 *   2. "auto" (let Hermes resolve it itself)
 *
 * Hermes's OWN resolution is the authority for anything the adapter did not
 * explicitly pin: its effective model/provider state lives in its session DB
 * and auth.json credential pool, not in static config files, and its
 * `parse_model_input` treats a `<known-provider>:` model id as an explicit
 * provider validated against that provider's live catalog. Static-file
 * detection (config.yaml parsing) and model-name prefix inference were
 * retired here: a vendor prefix does not identify a serving provider
 * (`deepseek-ai/*` is served by NVIDIA NIM and any router alike), and the
 * config default is not the effective state — guessing produced wrong
 * `--provider` flags that triggered resume-policy refusals and mis-routes.
 *
 * Always returns a valid provider string.
 * The `resolvedFrom` field indicates which source was used, useful for logging.
 */
export function resolveProvider(options: {
  /** Explicit provider from adapterConfig (user override) */
  explicitProvider?: string | null;
  /** Model name (accepted for call-site compatibility; never used to guess) */
  model?: string;
}): { provider: string; resolvedFrom: string } {
  const { explicitProvider } = options;

  // 1. Explicit provider from adapterConfig — user override, always wins.
  //    The setup catalog lists every provider in the installed Hermes
  //    registry (e.g. "nvidia"), not just the built-in CLI names in
  //    VALID_PROVIDERS, and `hermes chat --provider` accepts registry names
  //    too. Rerouting an explicit choice through model-name inference once
  //    sent runs to the wrong provider entirely, so pass the user's choice
  //    through unchanged; Hermes itself reports unknown providers clearly.
  if (explicitProvider) {
    return {
      provider: explicitProvider,
      resolvedFrom: (VALID_PROVIDERS as readonly string[]).includes(explicitProvider)
        ? "adapterConfig"
        : "adapterConfigRegistry",
    };
  }

  // 2. Let Hermes auto-detect from its own effective state (session DB /
  //    auth.json / host config) — never from Pilibala-side static guesses.
  return { provider: "auto", resolvedFrom: "auto" };
}
