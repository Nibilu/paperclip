/**
 * Hermes provider and model discovery for Paperclip setup UX.
 *
 * Two sources, both read-only against the host Hermes installation:
 *
 * 1. Provider list — the installed Hermes `providers` package registry
 *    (plugins/model-providers/*), enumerated through the Hermes venv's Python.
 *    Each entry carries name, base URL, credential env vars, and fallback
 *    models. This is what the UI shows as the "Model provider" options.
 *
 * 2. Live model list — when a provider exposes an OpenAI-compatible
 *    /v1/models endpoint and a credential exists in ~/.hermes/.env (or the
 *    environment), fetch it. Providers without a key fall back to the
 *    registry's fallback_models. Discovery failures never throw: they
 *    degrade to the fallback list with a `discovered: false` marker.
 *
 * Results are cached briefly (60s) because the provider registry import is
 * not free and setup screens re-render.
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export interface HermesProviderEntry {
  name: string;
  baseUrl: string;
  envVars: string[];
  fallbackModels: string[];
}

export interface HermesModelListResult {
  provider: string;
  models: string[];
  /** True when the list came from a live /v1/models fetch. */
  discovered: boolean;
  /** Present when discovery degraded (no credential, endpoint error, timeout). */
  reason?: string;
}

const CACHE_TTL_MS = 60_000;
let providerCache: { at: number; entries: HermesProviderEntry[] } | null = null;
const modelCache = new Map<string, { at: number; result: HermesModelListResult }>();

/** Discovery must never hang setup: cap both the Python registry read and each HTTP fetch. */
const REGISTRY_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 12_000;

/** Providers whose registry entries already represent user config, not a real upstream. */
const NON_UPSTREAM_PROVIDERS = new Set([
  "custom",
  "auto",
  "router",
  "ollama-cloud",
]);

/** Prefer the Hermes venv interpreter; fall back to `python3` on PATH. */
function hermesPythonCandidates(): string[] {
  const home = process.env.HERMES_HOME
    ? pathResolve(process.env.HERMES_HOME, "..", "hermes-agent")
    : join(homedir(), ".hermes", "hermes-agent");
  return [
    join(home, "venv", "bin", "python3"),
    join(home, ".venv", "bin", "python3"),
    "python3",
  ];
}

function pathResolve(...parts: string[]): string {
  // Local resolve so this module has no node:path import weight beyond need.
  const joined = parts.reduce(
    (acc, part) => (part.startsWith("/")
      ? part
      : acc ? `${acc}/${part}` : part),
    "",
  );
  const out: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** Run the registry enumeration inside Hermes's own interpreter. */
async function readProviderRegistry(): Promise<HermesProviderEntry[]> {
  const script = `
import json, sys
try:
    sys.path.insert(0, "/home/amber/.hermes/hermes-agent")
except Exception:
    pass
from providers import list_providers
out = []
for p in list_providers():
    name = getattr(p, "name", "") or ""
    if not name:
        continue
    out.append({
        "name": name,
        "baseUrl": getattr(p, "base_url", "") or "",
        "envVars": [v for v in (getattr(p, "env_vars", ()) or ()) if isinstance(v, str)],
        "fallbackModels": [m for m in (getattr(p, "fallback_models", ()) or ()) if isinstance(m, str)],
    })
print(json.dumps(out))
`;
  let lastError: unknown = null;
  for (const python of hermesPythonCandidates()) {
    try {
      const { stdout } = await execFileAsync(python, ["-c", script], {
        timeout: REGISTRY_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout.trim()) as HermesProviderEntry[];
      return parsed.filter((entry) => !NON_UPSTREAM_PROVIDERS.has(entry.name));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("provider registry unavailable");
}

/** Read credentials from ~/.hermes/.env (secrets only — never returned to the UI). */
async function readHermesEnv(): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const envPath of [join(homedir(), ".hermes", ".env")]) {
    let content: string;
    try {
      content = await readFile(envPath, "utf-8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value && !values[key]) values[key] = value;
    }
  }
  return values;
}

function authHeaderFor(entry: HermesProviderEntry, hermesEnv: Record<string, string>): string | null {
  const base = entry.baseUrl.trim();
  // Anthropic-style providers use x-api-key; everything Hermes lists on an
  // OpenAI-compatible base URL takes a bearer token.
  const key = entry.envVars
    .map((name) => process.env[name] ?? hermesEnv[name])
    .find((value) => typeof value === "string" && value.length > 0);
  if (!key) return null;
  if (base.includes("api.anthropic.com")) return `x-api-key: ${key}`;
  return `Bearer ${key}`;
}

/** Models endpoint candidates for a provider base URL. */
function modelsUrlFor(entry: HermesProviderEntry): string | null {
  const base = entry.baseUrl.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base)) return null;
  // OpenAI-compatible base URLs already end at the version root.
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

export async function listHermesProviders(): Promise<HermesProviderEntry[]> {
  if (providerCache && Date.now() - providerCache.at < CACHE_TTL_MS) {
    return providerCache.entries;
  }
  const entries = await readProviderRegistry();
  providerCache = { at: Date.now(), entries };
  return entries;
}

export async function listHermesProviderModels(
  provider: string,
): Promise<HermesModelListResult> {
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const entries = await listHermesProviders();
  const entry = entries.find((candidate) => candidate.name === provider);
  const fallback: HermesModelListResult = {
    provider,
    models: entry?.fallbackModels ?? [],
    discovered: false,
    ...(entry ? {} : { reason: "unknown_provider" }),
  };
  if (!entry) {
    modelCache.set(provider, { at: Date.now(), result: fallback });
    return fallback;
  }

  const hermesEnv = await readHermesEnv();
  const auth = authHeaderFor(entry, hermesEnv);
  const url = modelsUrlFor(entry);
  if (!auth || !url) {
    const result: HermesModelListResult = {
      ...fallback,
      ...(auth ? {} : { reason: "no_credential" }),
    };
    modelCache.set(provider, { at: Date.now(), result });
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers: Record<string, string> =
      auth.startsWith("x-api-key:")
        ? { "x-api-key": auth.slice("x-api-key:".length).trim(), "anthropic-version": "2023-06-01" }
        : { Authorization: auth };
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const result: HermesModelListResult = {
        ...fallback,
        reason: `http_${response.status}`,
      };
      modelCache.set(provider, { at: Date.now(), result });
      return result;
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = (payload.data ?? [])
      .map((model) => (typeof model?.id === "string" ? model.id : null))
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b));
    const result: HermesModelListResult = models.length
      ? { provider, models, discovered: true }
      : { ...fallback, reason: "empty_catalog" };
    modelCache.set(provider, { at: Date.now(), result });
    return result;
  } catch (error) {
    const result: HermesModelListResult = {
      ...fallback,
      reason: error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "endpoint_unreachable",
    };
    modelCache.set(provider, { at: Date.now(), result });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook: drop caches so tests exercise fresh discovery. */
export function resetHermesDiscoveryCache(): void {
  providerCache = null;
  modelCache.clear();
}
