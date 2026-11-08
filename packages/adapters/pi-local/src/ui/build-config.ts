import { buildAdapterEnvConfig, type CreateConfigValues } from "@pilibalaai/adapter-utils";

export function buildPiLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.model) ac.model = v.model;
  const nativeSelected = v.runner === "pilibala"
    || ((v.runner === undefined || v.runner === "auto") && v.resolvedRunner === "pilibala");
  if (nativeSelected) {
    const thinking = v.adapterSchemaValues?.piThinkingLevel ?? v.thinkingEffort;
    if (thinking) ac.piThinkingLevel = thinking;
    if (v.adapterSchemaValues?.acpxPermissionMode !== undefined) ac.acpxPermissionMode = v.adapterSchemaValues.acpxPermissionMode;
    if (v.pilibalaRunnerLifecycleMode !== undefined) ac.lifecycleMode = v.pilibalaRunnerLifecycleMode;
    if (v.pilibalaRunnerIdleTimeoutMs !== undefined) ac.idleTimeoutMs = v.pilibalaRunnerIdleTimeoutMs;
  } else if (v.thinkingEffort) ac.thinking = v.thinkingEffort;
  
  // Pi sessions can run until the CLI exits naturally; keep timeout disabled (0)
  ac.timeoutSec = 0;
  ac.graceSec = 20;
  
  const env = buildAdapterEnvConfig(v.envBindings, v.envVars);
  if (Object.keys(env).length > 0) ac.env = env;
  if (v.command) ac.command = v.command;
  if (v.extraArgs) ac.extraArgs = v.extraArgs;
  if (v.args) ac.args = v.args;

  return ac;
}
