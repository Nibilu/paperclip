/**
 * Hermes ACP execution engine (shared acpx-engine lane).
 *
 * Mirrors the Gemini adapter seam (`gemini-local/src/server/acp.ts`): the shared
 * acpx engine owns run lifecycle, session resume/fallback, permissions, and
 * settlement; the adapter only maps Hermes config onto engine config, resolves
 * the `hermes-acp` server command, and classifies billing identity.
 *
 * Hermes-specific notes:
 * - acpx has no built-in "hermes" agent entry, so this adapter always sets
 *   `agent: "hermes"` plus an explicit `agentCommand` override (default
 *   `hermes-acp`), which the engine forwards into its agent registry overrides.
 * - Hermes reads its provider/model config from `$HERMES_HOME` (default
 *   `~/.hermes`). Host-side local runs inherit `HOME` through the engine's
 *   closed host-env projection; remote sandbox runs must ship Hermes config via
 *   adapter `env` (there is no managed-home seam for Hermes in v1 — mirror of
 *   the Gemini "no credential copy-back" posture).
 * - The Hermes ACP server (hermes-agent `acp_adapter`) declares
 *   `loadSession: true` and `sessionCapabilities: { resume, list, fork }`, so
 *   acpx's resume path (`session/resume`, falling back to `session/load`) and
 *   the engine's resume-failure → fresh-session retry work unmodified.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AdapterBillingType,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@pilibalaai/adapter-utils";

import {
  ensureAdapterExecutionTargetCommandResolvable,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
} from "@pilibalaai/adapter-utils/execution-target";
import {
  DEFAULT_ACP_ENGINE_MODE,
  DEFAULT_ACP_ENGINE_NON_INTERACTIVE_PERMISSIONS,
  DEFAULT_ACP_ENGINE_PERMISSION_MODE,
  DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS,
} from "@pilibalaai/adapter-utils/acpx-engine/constants";
import type {
  AcpxEngineExecutorOptions,
} from "@pilibalaai/adapter-utils/acpx-engine/execute";
import {
  asString,
  parseObject,
} from "@pilibalaai/adapter-utils/server-utils";

import { HERMES_ACP_COMMAND } from "../shared/constants.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRootDir = path.resolve(moduleDir, "../..");
const MIN_ACP_NODE_VERSION = "24.11.0";

export type HermesExecutionEngine = "cli" | "acp";

export interface HermesEngineSelection {
  engine: HermesExecutionEngine;
  explicit: boolean;
  unavailableReason?: string;
}

type HermesEngineResolutionInput =
  Pick<AdapterExecutionContext, "config"> &
  Partial<Pick<AdapterExecutionContext, "executionTarget" | "executionTransport">>;

type HermesAcpExecutorOptions = Omit<
  AcpxEngineExecutorOptions,
  "adapterType" | "moduleDir" | "packageRootDir"
>;

type HermesAcpExecutor = (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>;

function normalizeEngine(value: unknown): HermesEngineSelection {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "acp") return { engine: "acp", explicit: true };
  if (raw === "cli") return { engine: "cli", explicit: true };
  // Default engine stays "cli": the Hermes CLI lane is the long-standing
  // production path; ACP is opt-in until it has soak time.
  return { engine: "cli", explicit: false };
}

export function resolveHermesExecutionEngine(config: Record<string, unknown>): HermesEngineSelection {
  return normalizeEngine(config.engine);
}

export async function resolveHermesExecutionEngineForRun(
  input: HermesEngineResolutionInput,
): Promise<HermesEngineSelection> {
  const selection = normalizeEngine(input.config.engine);
  // Engine availability must never change the agent's execution or permission contract.
  if (selection.engine === "cli") return selection;
  const unavailable = (reason: string): HermesEngineSelection => ({
    ...selection,
    unavailableReason: `${reason} Repair the ACP setup, or explicitly set engine=cli to use the CLI engine.`,
  });

  const reason = await hermesAcpUnavailableReason(input);
  return reason ? unavailable(reason) : selection;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function buildHermesAcpConfig(config: Record<string, unknown>): Record<string, unknown> {
  // acpx has no built-in "hermes" agent entry: an unset agentCommand would make
  // its registry fall back to spawning the bare `hermes` CLI (a TTY REPL whose
  // banner and warnings corrupt the ACP NDJSON stdout). The adapter therefore
  // always pins agentCommand — explicit override first, `hermes-acp` (resolved
  // from PATH at spawn) as the default.
  const agentCommand =
    firstNonEmptyString(config.agentCommand, config.acpAgentCommand, config.hermesCommand) ??
    HERMES_ACP_COMMAND;
  const stateDir = firstNonEmptyString(config.stateDir, config.acpStateDir);
  const mode = firstNonEmptyString(config.mode, config.acpMode) ?? DEFAULT_ACP_ENGINE_MODE;
  const permissionMode =
    firstNonEmptyString(config.permissionMode, config.acpPermissionMode) ??
    DEFAULT_ACP_ENGINE_PERMISSION_MODE;
  const nonInteractivePermissions =
    firstNonEmptyString(config.nonInteractivePermissions, config.acpNonInteractivePermissions) ??
    DEFAULT_ACP_ENGINE_NON_INTERACTIVE_PERMISSIONS;
  const warmHandleIdleMs =
    config.warmHandleIdleMs ??
    config.acpWarmHandleIdleMs ??
    DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS;

  // Provider↔model transport guard: the ACP protocol carries a bare model id,
  // and Hermes's no-explicit-provider resolution searches ITS configured
  // custom providers before the current provider's live catalog — a stale
  // discovered snapshot on any custom provider can hijack the route (observed:
  // adapterConfig provider=nvidia ran on custom:proxy-router). Hermes treats
  // "<known-provider>:" as an EXPLICIT provider (hermes_cli parse_model_input),
  // validating the pair against THAT provider's live catalog (ModelRejected on
  // mismatch), so qualifying the id keeps the persisted association intact
  // across the transport.
  const provider = firstNonEmptyString(config.provider, config.modelProvider);
  const model = firstNonEmptyString(config.model);
  const qualifiedModel =
    provider && provider !== "auto" && model && !model.startsWith(`${provider}:`)
      ? `${provider}:${model}`
      : model;

  return {
    ...config,
    // acpx's built-in registry has no "hermes" entry; the explicit agentCommand
    // override is what makes the shared engine launch the Hermes ACP server.
    agent: "hermes",
    ...(qualifiedModel ? { model: qualifiedModel } : {}),
    mode,
    permissionMode,
    nonInteractivePermissions,
    warmHandleIdleMs,
    agentCommand,
    ...(stateDir ? { stateDir } : {}),
  };
}

/**
 * Billing identity for the cost ledger. Hermes resolves providers itself from
 * `$HERMES_HOME`; Pilibala cannot see the effective provider from here, so the
 * ACP lane reports an opaque-but-honest "hermes" provider with an unknown
 * billing type rather than guessing openai/anthropic.
 */
export function resolveHermesAcpBillingIdentity(): {
  provider: string;
  biller: string;
  billingType: AdapterBillingType;
} {
  return { provider: "hermes", biller: "hermes", billingType: "unknown" };
}

export function createHermesAcpExecutor(options: HermesAcpExecutorOptions = {}): HermesAcpExecutor {
  let executor: HermesAcpExecutor | null = null;
  return async (ctx) => {
    let currentExecutor = executor;
    if (!currentExecutor) {
      const { createAcpxEngineExecutor } = await import("@pilibalaai/adapter-utils/acpx-engine/execute");
      currentExecutor = createAcpxEngineExecutor({
        resolveBillingIdentity: resolveHermesAcpBillingIdentity,
        ...options,
        adapterType: "hermes_local",
        moduleDir,
        packageRootDir,
      });
      executor = currentExecutor;
    }
    return currentExecutor({
      ...ctx,
      config: buildHermesAcpConfig(ctx.config),
    });
  };
}

function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nodeVersionMeetsHermesAcpMinimum(version = process.version): boolean {
  const [major, minor, patch] = parseVersion(version);
  const [minMajor, minMinor, minPatch] = parseVersion(MIN_ACP_NODE_VERSION);
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function looksLikeShellCommand(command: string): boolean {
  return /\s/.test(command.trim());
}

async function findCommandOnPath(binName: string, pathValue = process.env.PATH ?? ""): Promise<string | null> {
  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) continue;
    const candidate = path.join(segment, binName);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function commandIsResolvable(
  command: string,
  input?: HermesEngineResolutionInput,
): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (looksLikeShellCommand(trimmed)) return true;
  const target = readAdapterExecutionTarget({
    executionTarget: input?.executionTarget,
    legacyRemoteExecution: input?.executionTransport?.remoteExecution,
  });
  if (target?.kind === "remote") {
    try {
      await ensureAdapterExecutionTargetCommandResolvable(
        trimmed,
        target,
        resolveAdapterExecutionTargetCwd(target, asString(input?.config.cwd, ""), process.cwd()),
        process.env,
      );
      return true;
    } catch {
      return false;
    }
  }
  if (path.isAbsolute(trimmed) || hasPathSeparator(trimmed)) return pathExists(trimmed);
  return (await findCommandOnPath(trimmed)) !== null;
}

async function resolveHermesAcpCommand(config: Record<string, unknown>): Promise<string> {
  const configured = firstNonEmptyString(config.agentCommand, config.acpAgentCommand, config.hermesCommand);
  if (configured) return configured;
  return (await findCommandOnPath(HERMES_ACP_COMMAND)) ?? HERMES_ACP_COMMAND;
}

async function hermesAcpUnavailableReason(
  input: HermesEngineResolutionInput,
): Promise<string | null> {
  if (!nodeVersionMeetsHermesAcpMinimum()) {
    return `Node ${process.version} (${process.execPath}) does not satisfy Hermes ACP's Node >=${MIN_ACP_NODE_VERSION} prerequisite.`;
  }
  const command = await resolveHermesAcpCommand(input.config);
  if (!(await commandIsResolvable(command, input))) {
    return `Hermes ACP server command is not available: ${command}.`;
  }
  return null;
}

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function testHermesAcpEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";

  checks.push({
    code: "hermes_engine_selected",
    level: "info",
    message: "Execution engine selected: ACP.",
    hint: "Set engine=cli to use the existing Hermes CLI lane.",
  });

  const cwd = asString(config.cwd, process.cwd());
  try {
    await fs.mkdir(cwd, { recursive: true });
    checks.push({
      code: "hermes_acp_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "hermes_acp_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  checks.push({
    code: nodeVersionMeetsHermesAcpMinimum() ? "hermes_acp_node_supported" : "hermes_acp_node_unsupported",
    level: nodeVersionMeetsHermesAcpMinimum() ? "info" : "error",
    message: nodeVersionMeetsHermesAcpMinimum()
      ? `Node ${process.version} satisfies ACP runtime requirements.`
      : `Node ${process.version} (${process.execPath}) does not satisfy ACP runtime requirements.`,
    hint: nodeVersionMeetsHermesAcpMinimum()
      ? undefined
      : `Run Hermes ACP with Node >=${MIN_ACP_NODE_VERSION} or switch engine=cli.`,
  });

  const command = await resolveHermesAcpCommand(config);
  const commandResolvable = await commandIsResolvable(command, {
    config,
    executionTarget: ctx.executionTarget,
  });
  checks.push({
    code: commandResolvable ? "hermes_acp_command_resolvable" : "hermes_acp_command_missing",
    level: commandResolvable ? "info" : "error",
    message: commandResolvable
      ? `Hermes ACP server command is executable: ${command}`
      : `Hermes ACP server command is not available: ${command}`,
    hint: commandResolvable
      ? undefined
      : "Install hermes-agent (provides hermes-acp), or set agentCommand to a valid Hermes ACP server command.",
  });

  // Hermes authenticates from $HERMES_HOME; on a remote sandbox the host's
  // ~/.hermes is not shipped, so warn unless the adapter env carries an
  // explicit HERMES_HOME.
  const envConfig = parseObject(config.env);
  if (targetIsRemote && !isNonEmpty(envConfig.HERMES_HOME)) {
    checks.push({
      code: "hermes_acp_remote_home_unconfigured",
      level: "warn",
      message: "Remote ACP runs do not inherit the host HERMES_HOME.",
      hint: "Set HERMES_HOME (and any provider keys) in the agent adapter env so the in-sandbox Hermes can authenticate.",
    });
  }

  const mode = firstNonEmptyString(config.mode, config.acpMode) ?? DEFAULT_ACP_ENGINE_MODE;
  const warmHandleIdleMs = config.warmHandleIdleMs ?? config.acpWarmHandleIdleMs ?? DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS;
  checks.push({
    code: "hermes_acp_runtime_scaffold",
    level: "info",
    message: "Hermes ACP runtime execution is available through the shared ACP engine.",
    detail: `mode=${mode}; warmHandleIdleMs=${warmHandleIdleMs}`,
  });

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
