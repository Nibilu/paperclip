import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

import {
  DEFAULT_ACP_ENGINE_MODE,
  DEFAULT_ACP_ENGINE_NON_INTERACTIVE_PERMISSIONS,
  DEFAULT_ACP_ENGINE_PERMISSION_MODE,
  DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS,
} from "@paperclipai/adapter-utils/acpx-engine/constants";

import {
  DEFAULT_GRACE_SEC,
  DEFAULT_TIMEOUT_SEC,
  VALID_PROVIDERS,
} from "../shared/constants.js";

const acpVisible = { visibleWhen: { key: "engine", values: ["acp"] } };

function providerLabel(provider: string): string {
  if (provider === "auto") return "Auto";
  if (provider === "openai-codex") return "OpenAI Codex";
  if (provider === "kimi-coding") return "Kimi Coding";
  if (provider === "minimax-cn") return "MiniMax China";
  return provider
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "engine",
        label: "Execution engine",
        type: "select",
        default: "cli",
        options: [
          { value: "cli", label: "Hermes CLI (default)" },
          { value: "acp", label: "ACP (shared engine)" },
        ],
        hint: "CLI shells out to `hermes chat`. ACP runs Hermes's Agent Client Protocol server through Paperclip's shared ACP engine.",
      },
      {
        key: "agentCommand",
        label: "ACP server command",
        type: "text",
        hint: "Optional override for the Hermes ACP server command. Defaults to hermes-acp on PATH.",
        meta: acpVisible,
      },
      {
        key: "mode",
        label: "ACP session mode",
        type: "select",
        default: DEFAULT_ACP_ENGINE_MODE,
        options: [
          { value: "persistent", label: "Persistent" },
          { value: "oneshot", label: "One-shot" },
        ],
        hint: "Persistent keeps ACP session state between runs. One-shot starts fresh each run.",
        meta: acpVisible,
      },
      {
        key: "nonInteractivePermissions",
        label: "ACP non-interactive permissions",
        type: "select",
        default: DEFAULT_ACP_ENGINE_NON_INTERACTIVE_PERMISSIONS,
        options: [
          { value: "deny", label: "Deny" },
          { value: "fail", label: "Fail" },
        ],
        hint: "Fallback if the ACP agent asks for input outside an interactive session.",
        meta: acpVisible,
      },
      {
        key: "stateDir",
        label: "ACP state directory",
        type: "text",
        hint: "Optional ACP session state directory. Defaults to Paperclip-managed company/agent scoped storage.",
        meta: acpVisible,
      },
      {
        key: "warmHandleIdleMs",
        label: "ACP warm process idle ms",
        type: "number",
        default: DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS,
        hint: "Defaults to 0, which closes the ACP process after each run while retaining persistent session state.",
        meta: acpVisible,
      },
      {
        key: "provider",
        label: "Provider",
        type: "select",
        default: "auto",
        options: VALID_PROVIDERS.map((provider) => ({
          value: provider,
          label: providerLabel(provider),
        })),
        hint: "Usually auto. Set this only when Hermes cannot infer the provider from the model or ~/.hermes/config.yaml.",
      },
      {
        key: "timeoutSec",
        label: "Timeout seconds",
        type: "number",
        default: DEFAULT_TIMEOUT_SEC,
      },
      {
        key: "graceSec",
        label: "Grace seconds",
        type: "number",
        default: DEFAULT_GRACE_SEC,
        hint: "Seconds to wait after SIGTERM before killing the Hermes process.",
      },
      {
        key: "maxTurnsPerRun",
        label: "Max turns per run",
        type: "number",
        hint: "Optional Hermes --max-turns limit for tool-calling iterations.",
      },
      {
        key: "toolsets",
        label: "Toolsets",
        type: "text",
        hint: "Optional comma-separated Hermes toolsets, such as terminal,file,web.",
      },
      {
        key: "persistSession",
        label: "Persist session",
        type: "toggle",
        default: true,
        hint: "Resume Hermes sessions across Paperclip heartbeats.",
      },
      {
        key: "worktreeMode",
        label: "Hermes worktree mode",
        type: "toggle",
        default: false,
        hint: "Pass Hermes --worktree.",
      },
      {
        key: "checkpoints",
        label: "Checkpoints",
        type: "toggle",
        default: false,
        hint: "Pass Hermes --checkpoints.",
      },
      {
        key: "quiet",
        label: "Quiet output",
        type: "toggle",
        default: true,
        hint: "Pass Hermes --quiet for cleaner Paperclip run transcripts.",
      },
      {
        key: "verbose",
        label: "Verbose output",
        type: "toggle",
        default: false,
        hint: "Pass Hermes --verbose.",
      },
      {
        key: "paperclipApiUrl",
        label: "Paperclip API URL",
        type: "text",
        hint: "Optional API base override. Defaults to PAPERCLIP_API_URL.",
      },
      {
        key: "promptTemplate",
        label: "Prompt template",
        type: "textarea",
        hint: "Optional custom prompt template with {{variable}} placeholders.",
      },
    ],
  };
}
