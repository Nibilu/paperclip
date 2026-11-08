/**
 * Hermes Agent adapter for Pilibala.
 *
 * Runs Hermes Agent (https://github.com/NousResearch/hermes-agent)
 * as a managed employee in a Pilibala company. Hermes Agent is a
 * full-featured AI agent with 30+ native tools, persistent memory,
 * skills, session persistence, and MCP support.
 *
 * @packageDocumentation
 */

import type {
  AdapterRuntimeCommandSpec,
  AdapterSessionManagement,
  ServerAdapterModule,
} from "@pilibalaai/adapter-utils";

import { ADAPTER_TYPE, ADAPTER_LABEL } from "./shared/constants.js";
import {
  execute,
  testEnvironment,
  sessionCodec,
  listSkills,
  syncSkills,
  detectModel,
  getConfigSchema,
} from "./server/index.js";
import { resolveHermesCommand } from "./server/execute.js";

export const type = ADAPTER_TYPE;
export const label = ADAPTER_LABEL;
export {
  createServerAdapter as createHermesGatewayServerAdapter,
  agentConfigurationDoc as hermesGatewayAgentConfigurationDoc,
  label as hermesGatewayLabel,
  models as hermesGatewayModels,
  type as hermesGatewayType,
} from "./gateway/index.js";

/**
 * Models available through Hermes Agent.
 *
 * Hermes supports any model via any provider. The Pilibala UI should
 * prefer detectModel() plus manual entry over curated placeholder models,
 * since Hermes availability depends on the user's local configuration.
 */
export const models: { id: string; label: string }[] = [];

/** Human-readable provider names for the setup picker. */
function providerDisplayName(provider: string): string {
  const overrides: Record<string, string> = {
    nvidia: "NVIDIA NIM",
    zai: "Z.AI",
    "kimi-coding": "Kimi Coding",
    "openai-codex": "OpenAI Codex",
    "minimax-cn": "MiniMax China",
    "kilocode": "Kilo Code",
  };
  return (
    overrides[provider] ??
    provider
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}


const sessionManagement: AdapterSessionManagement = {
  supportsSessionResume: true,
  nativeContextManagement: "confirmed",
  defaultSessionCompaction: {
    enabled: true,
    maxSessionRuns: 0,
    maxRawInputTokens: 0,
    maxSessionAgeHours: 0,
  },
};

function getRuntimeCommandSpec(config: Record<string, unknown>): AdapterRuntimeCommandSpec {
  const command = resolveHermesCommand(config);
  return {
    command,
    detectCommand: command,
    installCommand: null,
  };
}

/**
 * Documentation shown in the Pilibala UI when configuring a Hermes agent.
 */
export const agentConfigurationDoc = `# Hermes Agent Configuration

Hermes Agent is a full-featured AI agent by Nous Research with 30+ native
tools, persistent memory, session persistence, skills, and MCP support.

## Prerequisites

- Python 3.10+ installed
- Hermes Agent installed: \`pip install hermes-agent\`
- At least one LLM API key configured in ~/.hermes/.env

## Core Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| engine | select | cli | Execution engine. \`cli\` shells out to \`hermes chat\`; \`acp\` runs Hermes's Agent Client Protocol server (\`hermes-acp\`) through Pilibala's shared ACP engine (session resume, permission handling, and run lifecycle come from the shared engine). |
| model | string | (Hermes configured default) | Optional explicit model in provider/model format. Leave blank to use Hermes's configured default model. |
| provider | string | (auto) | API provider: auto, openrouter, nous, openai-codex, zai, kimi-coding, minimax, minimax-cn. Usually not needed — Hermes auto-detects from model name. |
| timeoutSec | number | 300 | Execution timeout in seconds |
| graceSec | number | 10 | Grace period after SIGTERM before SIGKILL |

## ACP Engine Fields (engine=acp)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| agentCommand | string | hermes-acp | Path/override for the Hermes ACP server command. |
| mode | select | persistent | \`persistent\` keeps ACP session state across runs; \`oneshot\` starts fresh each run. |
| nonInteractivePermissions | select | deny | Fallback when the ACP agent asks for input outside an interactive session. |
| stateDir | string | (managed) | ACP session state directory. Defaults to Pilibala-managed company/agent scoped storage. |
| warmHandleIdleMs | number | 0 | 0 closes the ACP process after each run while retaining persistent session state. |

## Tool Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| toolsets | string | (all) | Comma-separated toolsets to enable (e.g. "terminal,file,web") |

## Session & Workspace

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| cwd | string | (assigned task workspace) | Absolute working directory override; otherwise use Pilibala's resolved task workspace |
| persistSession | boolean | true | Resume sessions across heartbeats |
| worktreeMode | boolean | false | Use git worktree for isolated changes |
| checkpoints | boolean | false | Enable filesystem checkpoints |

## Advanced

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| hermesCommand | string | hermes | Path to hermes CLI binary |
| verbose | boolean | false | Enable verbose output |
| extraArgs | string[] | [] | Additional CLI arguments |
| env | object | {} | Extra environment variables |
| promptTemplate | string | (default) | Custom prompt template with {{variable}} placeholders |

Managed \`instructionsFilePath\` bundles and standard Pilibala API guidance use
Hermes's native \`HERMES_EPHEMERAL_SYSTEM_PROMPT\` overlay on every run, including
resume and reset. They are applied at request time and are not appended to user
history. The query keeps current runtime identity, wake/task content, and custom
templates. Use a Hermes CLI that supports this environment hook. An explicit
overlay in \`env\` is preserved; the hook takes precedence over Hermes's configured
profile personality/system prompt.

## Hermes-Originated Pilibala Tasks

This adapter package also ships a Hermes-facing Pilibala task bridge skill:
\`pilibala-task-bridge\`. Use it when a user starts in Hermes and asks Hermes
to create, comment on, update, or list Pilibala tasks.

Configure credentials through Hermes env/profile secrets, never in prompt text:

- \`PILIBALA_API_URL\` - Pilibala base URL, with or without \`/api\`
- \`PILIBALA_BRIDGE_API_KEY\` - Pilibala agent API key created with \`scope.kind = "task_bridge"\`
- optional fallback \`PILIBALA_API_KEY\` - must still be a task_bridge key, never a normal claimed agent key
- optional \`PILIBALA_COMPANY_ID\`, \`PILIBALA_AGENT_ID\`, and \`PILIBALA_RUN_ID\`

The bridge is separate from adapter execution:

- \`hermes_local\` means Pilibala shells out to local \`hermes chat\`.
- \`hermes_gateway\` means Pilibala wakes remote Hermes through Hermes's API server.
- \`pilibala-task-bridge\` means Hermes calls Pilibala's REST API to manage tasks.

Create task bridge keys with a parent issue or project boundary. Do not expose
normal claimed Pilibala agent API keys to internet-facing Hermes chat/webhook
task-bridge surfaces.

## Available Template Variables

- \`{{agentId}}\` — Pilibala agent ID
- \`{{agentName}}\` — Agent display name
- \`{{companyId}}\` — Pilibala company ID
- \`{{companyName}}\` — Company display name
- \`{{runId}}\` — Current heartbeat run ID
- \`{{taskId}}\` — Current task/issue ID (if assigned)
- \`{{taskTitle}}\` — Task title (if assigned)
- \`{{taskBody}}\` — Task description (if assigned)
- \`{{projectName}}\` — Project name (if scoped to a project)
`;

/**
 * External adapter plugin entrypoint expected by Pilibala's adapter manager.
 */
export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    sessionCodec,
    sessionManagement,
    listSkills,
    syncSkills,
    models,
    // Setup UX discovers models per provider: the Pilibala models route
    // passes the user's chosen provider through adapter.listModels(provider).
    // Discovery degrades to the provider registry's fallback models when a
    // provider has no credential or its endpoint is unreachable.
    listModels: async (provider?: string) => {
      if (!provider || provider === "auto") return [];
      const { listHermesProviderModels } = await import("./server/providers.js");
      const result = await listHermesProviderModels(provider);
      return result.models.map((id) => ({ id, label: id }));
    },
    // Provider catalog for the setup "Model provider" picker, sourced from
    // Hermes's own provider registry. Never exposes credential values.
    listProviders: async () => {
      const { listHermesProviders } = await import("./server/providers.js");
      const entries = await listHermesProviders();
      return entries.map((entry) => ({
        name: entry.name,
        label: providerDisplayName(entry.name),
        ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
        envVars: entry.envVars,
        fallbackModels: entry.fallbackModels,
      }));
    },
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    requiresMaterializedRuntimeSkills: false,
    getRuntimeCommandSpec,
    agentConfigurationDoc,
    detectModel,
    getConfigSchema,
    // Persistence-boundary write-guard: the (provider, model) pair is validated
    // against the provider's LIVE catalog before an agent config is stored, so
    // switching a model keeps the current provider and a stale/foreign pair is
    // rejected at write time instead of mis-routing at run time.
    validateConfig: async (adapterConfig) => {
      const { validateHermesAdapterConfig } = await import("./server/model-pair.js");
      await validateHermesAdapterConfig(adapterConfig);
    },
  };
}

export { createServerAdapter as createHermesLocalServerAdapter };
