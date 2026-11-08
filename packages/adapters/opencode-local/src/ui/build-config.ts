import { buildAdapterEnvConfig, type CreateConfigValues } from "@pilibalaai/adapter-utils";

function parseCommaArgs(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildOpenCodeLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.model) ac.model = v.model;
  if (v.thinkingEffort) ac.variant = v.thinkingEffort;
  ac.dangerouslySkipPermissions = v.dangerouslySkipPermissions;
  const nativeSelected = v.runner === "pilibala"
    || ((v.runner === undefined || v.runner === "auto") && v.resolvedRunner === "pilibala");
  if (nativeSelected) {
    if (v.adapterSchemaValues?.opencodePermissionMode !== undefined) ac.opencodePermissionMode = v.adapterSchemaValues.opencodePermissionMode;
    if (v.pilibalaRunnerLifecycleMode !== undefined) ac.lifecycleMode = v.pilibalaRunnerLifecycleMode;
    if (v.pilibalaRunnerIdleTimeoutMs !== undefined) ac.idleTimeoutMs = v.pilibalaRunnerIdleTimeoutMs;
  }
  // OpenCode sessions can run until the CLI exits naturally; keep timeout disabled (0)
  // and rely on graceSec for termination handling when a timeout is configured elsewhere.
  ac.timeoutSec = 0;
  ac.graceSec = 20;
  const env = buildAdapterEnvConfig(v.envBindings, v.envVars);
  if (Object.keys(env).length > 0) ac.env = env;
  if (v.command) ac.command = v.command;
  if (v.extraArgs) ac.extraArgs = parseCommaArgs(v.extraArgs);
  return ac;
}
