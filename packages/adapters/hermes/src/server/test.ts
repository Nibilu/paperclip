/**
 * Environment test for the Hermes Agent adapter.
 *
 * Verifies that Hermes Agent is installed, accessible, and configured
 * before allowing the adapter to be used.
 */

import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

import { HERMES_CLI, DEFAULT_MODEL, ADAPTER_TYPE, VALID_PROVIDERS } from "../shared/constants.js";
import { detectModel } from "./detect-model.js";
import { resolveHermesCommand } from "./execute.js";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";
import {
  resolveHermesExecutionEngineForRun,
  testHermesAcpEnvironment,
} from "./acp.js";

const execFileAsync = promisify(execFile);

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkCliInstalled(
  command: string,
): Promise<AdapterEnvironmentCheck | null> {
  try {
    // Try to run the command to see if it exists
    await execFileAsync(command, ["--version"], { timeout: 10_000 });
    return null; // OK — it ran successfully
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return {
        level: "error",
        message: `Hermes CLI "${command}" not found in PATH`,
        hint: "Install Hermes Agent: pip install hermes-agent",
        code: "hermes_cli_not_found",
      };
    }
    // Command exists but --version might have failed for some reason
    // Still consider it installed
    return null;
  }
}

async function checkCliVersion(
  command: string,
): Promise<AdapterEnvironmentCheck | null> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], {
      timeout: 10_000,
    });
    const version = stdout.trim();
    if (version) {
      return {
        level: "info",
        message: `Hermes Agent version: ${version}`,
        code: "hermes_version",
      };
    }
    return {
      level: "warn",
      message: "Could not determine Hermes Agent version",
      code: "hermes_version_unknown",
    };
  } catch {
    return {
      level: "warn",
      message:
        "Could not determine Hermes Agent version (hermes --version failed)",
      hint: "Make sure the hermes CLI is properly installed and functional",
      code: "hermes_version_failed",
    };
  }
}

async function checkPython(): Promise<AdapterEnvironmentCheck | null> {
  try {
    const { stdout } = await execFileAsync("python3", ["--version"], {
      timeout: 5_000,
    });
    const version = stdout.trim();
    const match = version.match(/(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major < 3 || (major === 3 && minor < 10)) {
        return {
          level: "error",
          message: `Python ${version} found — Hermes requires Python 3.10+`,
          hint: "Upgrade Python to 3.10 or later",
          code: "hermes_python_old",
        };
      }
    }
    return null; // OK
  } catch {
    return {
      level: "warn",
      message: "python3 not found in PATH",
      hint: "Hermes Agent requires Python 3.10+. Install it from python.org",
      code: "hermes_python_missing",
    };
  }
}

function checkModel(
  config: Record<string, unknown>,
): AdapterEnvironmentCheck | null {
  const model = asString(config.model);
  if (!model) {
    return {
      level: "info",
      message: "No model specified — Hermes will use its configured default model",
      hint: "Set a model explicitly in Paperclip only if you want to override your local Hermes configuration.",
      code: "hermes_configured_default_model",
    };
  }
  return {
    level: "info",
    message: `Model: ${model}`,
    code: "hermes_model_configured",
  };
}

async function checkApiKeys(
  config: Record<string, unknown>,
  detectedConfig: Awaited<ReturnType<typeof detectModel>> | null,
): Promise<AdapterEnvironmentCheck | null> {
  // The server resolves secret refs into config.env before calling testEnvironment,
  // so we check config.env first (adapter-configured secrets), then fall back to
  // process.env (server/host environment), then ~/.hermes/.env (Hermes local config).
  const envConfig = (config.env ?? {}) as Record<string, unknown>;
  const resolvedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string" && value.length > 0) resolvedEnv[key] = value;
  }

  // Also read ~/.hermes/.env — Hermes stores API keys there by default and does
  // not export them to the parent process, so Paperclip's process.env won't
  // contain them.  Parsing this file ensures the environment test reports
  // accurate results for keys that Hermes already knows about.
  const hermesEnvKeys: Record<string, string> = {};
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
    const hermesEnvPath = `${homeDir}/.hermes/.env`;
    const content = readFileSync(hermesEnvPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (value.length > 0) hermesEnvKeys[key] = value;
      }
    }
  } catch {
    // ~/.hermes/.env may not exist — that's fine
  }

  const has = (key: string): boolean =>
    !!(resolvedEnv[key] ?? process.env[key] ?? hermesEnvKeys[key]);

  const hasAnthropic = has("ANTHROPIC_API_KEY");
  const hasOpenRouter = has("OPENROUTER_API_KEY");
  const hasOpenAI = has("OPENAI_API_KEY");
  const hasZai = has("ZAI_API_KEY");
  const hasKimi = has("KIMI_API_KEY");
  const hasMiniMax = has("MINIMAX_API_KEY");

  const providers: string[] = [];
  if (hasAnthropic) providers.push("Anthropic");
  if (hasOpenRouter) providers.push("OpenRouter");
  if (hasOpenAI) providers.push("OpenAI");
  if (hasZai) providers.push("Z.AI");
  if (hasKimi) providers.push("Kimi");
  if (hasMiniMax) providers.push("MiniMax");

  if (providers.length > 0) {
    return {
      level: "info",
      message: `API keys found: ${providers.join(", ")}`,
      code: "hermes_api_keys_found",
    };
  }

  const requestedModel = asString(config.model);

  const supportedProviders = VALID_PROVIDERS as readonly string[];
  const modelMatchesRequested =
    !!detectedConfig?.model &&
    (!requestedModel || detectedConfig.model.toLowerCase() === requestedModel.toLowerCase());

  const matchingHermesConfigApiKey =
    !!detectedConfig?.hasApiKey &&
    modelMatchesRequested;

  if (matchingHermesConfigApiKey && detectedConfig) {
    const providerLabel = detectedConfig.provider.trim();

    if (!providerLabel) {
      return {
        level: "info",
        message: "Hermes config includes an API key for the requested model via ~/.hermes/config.yaml without an explicit provider",
        hint: "Skipping the built-in API-key warning because Hermes can use model.api_key from the local Hermes config.",
        code: "hermes_api_key_in_config",
      };
    }

    if (!supportedProviders.includes(providerLabel)) {
      return {
        level: "info",
        message: `Hermes config includes runtime settings for unsupported adapter provider "${providerLabel}" via ~/.hermes/config.yaml`,
        hint: "Skipping the built-in API-key warning because Hermes can resolve this provider at runtime.",
        code: "hermes_custom_provider_config",
      };
    }

    return {
      level: "info",
      message: `Hermes config includes an API key for provider "${providerLabel}" via ~/.hermes/config.yaml`,
      hint: "Skipping the built-in API-key warning because Hermes can use model.api_key from the local Hermes config.",
      code: "hermes_api_key_in_config",
    };
  }

  return {
    level: "warn",
    message: "No LLM API keys found in environment",
    hint: "Set API keys in the agent's env secrets or ~/.hermes/.env. Hermes supports: ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, ZAI_API_KEY, KIMI_API_KEY, MINIMAX_API_KEY",
    code: "hermes_no_api_keys",
  };
}

/**
 * Check provider/model consistency against the provider's LIVE catalog.
 *
 * The persisted pair is already validated at the persistence boundary; this
 * preflight re-checks it (catalog drift between write and run) and degrades
 * open when discovery cannot verify. Static config-file heuristics
 * (config.yaml parsing, name-prefix inference) are NOT used — they are not
 * the provider's source of truth.
 */
async function checkProviderConsistency(
  config: Record<string, unknown>,
): Promise<AdapterEnvironmentCheck | null> {
  const model = asString(config.model);
  if (!model) return null;

  const explicitProvider = asString(config.provider);

  if (!explicitProvider || explicitProvider === "auto") {
    // Host-default path: Paperclip does not guess a provider — Hermes resolves
    // its effective state (session DB / auth.json / host config) natively.
    return {
      level: "info",
      message: `No explicit provider for model "${model}" — Hermes resolves the provider from its own effective configuration`,
      code: "hermes_provider_deferred",
    };
  }

  try {
    const { validateHermesAdapterConfig } = await import("./model-pair.js");
    await validateHermesAdapterConfig({ provider: explicitProvider, model });
  } catch (err) {
    return {
      level: "warn",
      message: err instanceof Error ? err.message : String(err),
      hint: `Re-select the model for provider "${explicitProvider}" (or clear it to use Hermes's default) — switching the model keeps the current provider.`,
      code: "hermes_provider_model_pair_mismatch",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hello-probe failure classification
// ---------------------------------------------------------------------------

interface HelloProbeCause {
  code?: string | number;
  signal?: string;
  killed?: boolean;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  message?: string;
}

/**
 * Turn a failed managed-connection hello probe into a specific, actionable
 * check instead of one generic message. Classifies the provider-side errors
 * the probe actually hits (quota, auth, unknown model, timeout, missing CLI)
 * and falls back to the Hermes stderr tail for anything else. Never includes
 * credential values — only Hermes's own error text.
 */
function helloProbeFailureCheck(cause: unknown): AdapterEnvironmentCheck {
  const error = (cause ?? {}) as HelloProbeCause;
  const stderr = String(error.stderr ?? "");
  const combined = `${error.message ?? ""}\n${stderr}`;
  const generic = {
    level: "error" as const,
    code: "hermes_hello_probe_failed",
    message: "Hermes could not complete a request through this connection.",
  };

  // Node exec timeout / SIGTERM → the provider never answered in time.
  if (error.killed || error.signal === "SIGTERM" || error.code === "ABORT_ERR") {
    return {
      ...generic,
      code: "hermes_hello_probe_timeout",
      message: "Hermes did not complete a hello response within the timeout.",
      hint: "The provider may be slow or unreachable. Retry; if it persists, check the provider's status page or your network.",
    };
  }

  // Provider quota / rate limit.
  if (/\b429\b|rate.?limit|too many requests|quota/i.test(combined)) {
    return {
      ...generic,
      code: "hermes_provider_rate_limited",
      message: "The provider rejected the request: rate limit or quota exceeded (HTTP 429).",
      hint: "Wait for the rate-limit window to reset, or switch to a provider with available quota. The connection itself is configured correctly.",
    };
  }

  // Authentication / authorization.
  if (/\b40[13]\b|unauthorized|forbidden|invalid.{0,20}api.?key|authentication/i.test(combined)) {
    return {
      ...generic,
      code: "hermes_provider_auth_failed",
      message: "The provider rejected the credential (HTTP 401/403).",
      hint: "Re-enter the API key for this provider, or check that the key in ~/.hermes/.env is still valid for the selected model.",
    };
  }

  // Unknown model id.
  if (/\b404\b|model.?not.?found|does not exist|unknown model|not a valid model/i.test(combined)) {
    return {
      ...generic,
      code: "hermes_provider_model_unknown",
      message: "The provider does not recognize the selected model (HTTP 404).",
      hint: "Pick the model again from the provider's model list — the model ID may have changed or been retired.",
    };
  }

  // Hermes CLI missing.
  if (error.code === "ENOENT" || /not found in PATH|ENOENT/i.test(combined)) {
    return {
      ...generic,
      code: "hermes_cli_not_found",
      message: `Hermes CLI "${resolveHermesCommand({})}" not found in PATH`,
      hint: "Install Hermes Agent: pip install hermes-agent",
    };
  }

  // Anything else: surface the last meaningful Hermes error line.
  const stderrLines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^\s*$/.test(line));
  const tail = stderrLines[stderrLines.length - 1];
  return {
    ...generic,
    ...(tail
      ? {
          hint: `Hermes reported: ${tail.slice(0, 300)}`,
        }
      : {
          hint: "Check the Hermes installation, endpoint, credential, and model, then test again.",
        }),
  };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = (ctx.config ?? {}) as Record<string, unknown>;
  const engineSelection = await resolveHermesExecutionEngineForRun({
    config: parseObject(config),
    executionTarget: ctx.executionTarget,
  });
  if (engineSelection.unavailableReason) {
    return {
      adapterType: ADAPTER_TYPE,
      status: "fail",
      checks: [{
        code: "adapter_engine_unavailable",
        level: "error",
        message: engineSelection.unavailableReason,
      }],
      testedAt: new Date().toISOString(),
    };
  }
  if (engineSelection.engine === "acp") {
    return testHermesAcpEnvironment(ctx);
  }

  const command = resolveHermesCommand(config);
  const checks: AdapterEnvironmentCheck[] = [];

  // Managed connections must prove the selected destination with the isolated
  // runtime environment. Host credentials and ~/.hermes are not evidence.
  if (config.managedAiRouting) {
    const remote = ctx.executionTarget?.kind === "remote";
    if (remote) {
      checks.push({ level: "error", code: "hermes_remote_probe_unsupported", message: "Hermes connection testing requires a local execution environment." });
    } else {
      const env = { ...process.env };
      for (const [key, value] of Object.entries((config.env ?? {}) as Record<string, unknown>)) {
        if (typeof value === "string") env[key] = value;
      }
      const args = ["chat", "-Q", "-q", "Respond with hello. Do not use tools.", "--max-turns", "1"];
      if (asString(config.model)) args.push("-m", asString(config.model)!);
      const provider = asString(config.provider);
      if (provider && provider !== "auto") args.push("--provider", provider);
      try {
        const { stdout } = await execFileAsync(command, args, {
          env, cwd: asString(config.cwd), timeout: 45_000, maxBuffer: 1024 * 1024,
        });
        if (!/\bhello\b/i.test(stdout)) throw new Error("No hello response");
        checks.push({ level: "info", code: "hermes_hello_probe_passed", message: "Hermes responded through the selected connection." });
      } catch (cause) {
        checks.push(helloProbeFailureCheck(cause));
      }
    }
    return { adapterType: ADAPTER_TYPE, status: checks.some(check => check.level === "error") ? "fail" : "pass", checks, testedAt: new Date().toISOString() };
  }

  // 1. CLI installed?
  const cliCheck = await checkCliInstalled(command);
  if (cliCheck) {
    checks.push(cliCheck);
    if (cliCheck.level === "error") {
      return {
        adapterType: ADAPTER_TYPE,
        status: "fail",
        checks,
        testedAt: new Date().toISOString(),
      };
    }
  }

  // 2. CLI version
  const versionCheck = await checkCliVersion(command);
  if (versionCheck) checks.push(versionCheck);

  // 3. Python available?
  const pythonCheck = await checkPython();
  if (pythonCheck) checks.push(pythonCheck);

  // 4. Model config
  const modelCheck = checkModel(config);
  if (modelCheck) checks.push(modelCheck);

  // 5. Detect Hermes config once for the remaining checks (display metadata
  // for the API-key guidance; NOT a model/provider truth source).
  let detectedConfig: Awaited<ReturnType<typeof detectModel>> | null = null;
  try {
    detectedConfig = await detectModel();
  } catch {
    // Non-fatal
  }

  // 6. API keys (check config.env — server resolves secrets before calling us)
  const apiKeyCheck = await checkApiKeys(config, detectedConfig);
  if (apiKeyCheck) checks.push(apiKeyCheck);

  // 7. Provider/model consistency (live provider catalog)
  const providerCheck = await checkProviderConsistency(config);
  if (providerCheck) checks.push(providerCheck);

  // Determine overall status
  const hasErrors = checks.some((c) => c.level === "error");
  const hasWarnings = checks.some((c) => c.level === "warn");

  return {
    adapterType: ADAPTER_TYPE,
    status: hasErrors ? "fail" : hasWarnings ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
