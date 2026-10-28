/** Names minted by the controller from the resolved task configuration.
 * Values remain in the process environment, never in argv or this manifest.
 * Do not mint this projection from ambient process.env.
 */
export const CONFIGURED_ENVIRONMENT_KEYS = "PILIBALA_CONFIGURED_ENV_KEYS";

export const GENERATED_RUNTIME_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set([
  CONFIGURED_ENVIRONMENT_KEYS,
  "PILIBALA_AGENT_ID", "PILIBALA_AGENT_KEY_ID", "PILIBALA_AGENT_PUBLIC_KEY", "PILIBALA_AGENT_PRIVATE_KEY",
  "PILIBALA_API_KEY", "PILIBALA_API_URL", "PILIBALA_API_BRIDGE_MODE", "PILIBALA_COMPANY_ID", "PILIBALA_INSTANCE_ID",
  "PILIBALA_RUN_ID", "PILIBALA_NORMALIZED_SESSION_ID", "PILIBALA_RUNNER_INSTANCE_ID", "PILIBALA_RUNNER_BOOTSTRAP_TICKET", "PILIBALA_TASK_ID", "PILIBALA_APPROVAL_ID", "PILIBALA_APPROVAL_STATUS", "PILIBALA_LINKED_ISSUE_IDS",
  "PILIBALA_WAKE_REASON", "PILIBALA_WAKE_COMMENT_ID", "PILIBALA_WAKE_PAYLOAD_JSON", "PILIBALA_EXECUTION_MODE",
  "PILIBALA_WORKSPACES_JSON", "PILIBALA_WORKSPACE_ID", "PILIBALA_WORKSPACE_CWD", "PILIBALA_WORKSPACE_SOURCE",
  "PILIBALA_WORKSPACE_REPO_URL", "PILIBALA_WORKSPACE_REPO_REF", "PILIBALA_WORKSPACE_BRANCH",
  "PILIBALA_WORKSPACE_WORKTREE_PATH", "PILIBALA_WORKSPACE_REALIZATION_MODE", "PILIBALA_WORKSPACE_AUTHORITATIVE_ROOT",
  "PILIBALA_RUNTIME_PRIMARY_URL", "PILIBALA_RUNTIME_SERVICES_JSON", "PILIBALA_RUNTIME_SERVICE_INTENTS_JSON",
  "PILIBALA_AGENT_MESSAGE_KEY", "PILIBALA_HARNESS_CHECKOUT_KEY", "PILIBALA_EXTERNAL_CHAT_EXECUTION_BOUND_KEY",
  "PILIBALA_NATIVE_MCP_STDIO", "PILIBALA_NATIVE_MCP_PROXY",
  "PILIBALA_NATIVE_MCP_NAME", "PILIBALA_NATIVE_MCP_URL", "PILIBALA_NATIVE_MCP_TOKEN", "PILIBALA_AI_PROVIDER_KEY",
  "PILIBALA_PROVIDER_TRACE_PATH", "PILIBALA_PROVIDER_TRACE_MAX_BYTES", "PILIBALA_ACPX_CREDENTIAL_BINDING",
  "PILIBALA_RUNNER_NETWORK_ACCESS", "PILIBALA_RUNNER_NETWORK_ROOTS", "PILIBALA_RUNNER_EXTERNAL_SANDBOX",
  "PILIBALA_GITHUB_AUTH_MODE", "PILIBALA_GITHUB_HOST_HOME", "PILIBALA_GIT_METADATA_ROOTS",
  "PILIBALA_GITHUB_BROKER_TOKEN", "PILIBALA_GITHUB_BROKER_URL", "PILIBALA_GITHUB_BRIDGE_TOKEN", "PILIBALA_GITHUB_LAUNCHER_DIR",
]);

const RESERVED_KEYS = new Set([
  "PATH", "HOME", "USERPROFILE", "CODEX_HOME", "AGENT_HOME", "SHELL", "NODE_OPTIONS", "NODE_PATH",
  "PYTHONPATH", "PYTHONHOME", "RUBYOPT", "RUBYLIB", "PERL5OPT", "PERL5LIB", "BASH_ENV", "ENV",
  "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK", "OPENROUTER_API_KEY", "XAI_API_KEY", "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN",
  "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "PILIBALA_GIT_TOKEN",
]);

function eligibleKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
    && !GENERATED_RUNTIME_ENVIRONMENT_KEYS.has(upper)
    && !RESERVED_KEYS.has(upper)
    && !/^(?:LD_|DYLD_|GIT_CONFIG_|PILIBALA_(?:RUNNER_|NATIVE_|GITHUB_|ACPX_|VERIFIED_))/.test(upper);
}

function checkedNames(names: unknown): string[] {
  if (!Array.isArray(names) || names.length > 128 || names.some(name => typeof name !== "string" || !eligibleKey(name))
    || new Set(names).size !== names.length) throw new Error("Invalid configured environment projection");
  return (names as string[]).sort();
}

/** Mint at the server's resolved configuration boundary, before host inheritance. */
export function configuredEnvironmentProjection(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = checkedNames(Object.keys(source).filter(key => source[key] !== undefined && eligibleKey(key)));
  return configuredEnvironment({ ...source, [CONFIGURED_ENVIRONMENT_KEYS]: JSON.stringify(names) });
}

/** Accept only an explicitly supplied, controller-minted projection. */
export function configuredEnvironment(source: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const raw = source?.[CONFIGURED_ENVIRONMENT_KEYS];
  if (raw === undefined) return {};
  if (Buffer.byteLength(raw) > 20_000) throw new Error("Invalid configured environment projection");
  let names: string[];
  try { names = checkedNames(JSON.parse(raw)); } catch { throw new Error("Invalid configured environment projection"); }
  const result: NodeJS.ProcessEnv = {};
  let bytes = 0;
  for (const name of names) {
    const value = source?.[name];
    if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid configured environment value");
    const size = Buffer.byteLength(name) + Buffer.byteLength(value);
    bytes += size;
    if (size > 65_536 || bytes > 262_144) throw new Error("Configured environment exceeds its bounded launch size");
    result[name] = value;
  }
  result[CONFIGURED_ENVIRONMENT_KEYS] = JSON.stringify(names);
  return result;
}

export function configuredEnvironmentKeys(source: NodeJS.ProcessEnv | undefined): string[] {
  return Object.keys(configuredEnvironment(source)).filter(key => key !== CONFIGURED_ENVIRONMENT_KEYS).sort();
}
