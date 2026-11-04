import { redactDiagnosticText, REDACTED_COMMAND_TEXT_VALUE } from "../command-redaction.js";
import type { AdapterExecutionResult } from "../types.js";

export interface AcpxTerminalSessionFailure {
  category: string;
  title?: string;
  details?: string;
}

export interface AcpxTerminalSessionFailureDiagnostic extends AcpxTerminalSessionFailure {
  truncatedFields?: Array<"title" | "details">;
}

const CATEGORIES = new Set(["connection", "access", "limit", "service", "request", "unknown"]);

/** Inspect raw provider text before redaction can remove status codes or limits.
 * Only definition paths qualify: invalid call arguments and overloads remain
 * subject to their existing recovery contracts.
 */
export function classifyToolDefinitionFailure(
  failure: AcpxTerminalSessionFailure,
): Pick<AdapterExecutionResult, "errorCode" | "errorFamily"> | null {
  const text = `${failure.title ?? ""}\n${failure.details ?? ""}`;
  const definitionPath = /\btools(?:\.\d+|\[\d+\])(?:\.(?:custom|function))?\.(?:name|input_schema|parameters|description|type)\b/i;
  const validation = /at most|too long|max(?:imum)?[_ ]?length|invalid|not valid|must|should|schema|validation|unsupported/i;
  const namedDefinition = /(?:invalid|unsupported)\s+(?:tool|function)\s+(?:definition|schema|name)|invalid schema for (?:function|tool)/i;
  if ((definitionPath.test(text) && validation.test(text)) || namedDefinition.test(text)) {
    return { errorCode: "provider_tool_definition_invalid", errorFamily: "configuration" };
  }
  return null;
}
// Leave room under the server's 64 KiB run-log chunk limit even when every
// retained character needs JSON escaping. The transcript stores the text once.
const FIELD_LIMITS = { title: 4096, details: 24576 } as const;
// Only conventional public process settings may survive by default. Provider,
// proxy, bridge, and future launch contributions may carry secrets under any
// name. Explicitly configured values are still redacted even for these keys.
const PUBLIC_ENV_KEYS = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "HOME", "USERPROFILE",
  "HOMEDRIVE", "HOMEPATH", "USER", "USERNAME", "LOGNAME", "SHELL", "LANG",
  "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "TEMP", "TMP", "NODE_ENV",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
  "PILIBALA_AGENT_ID", "PILIBALA_COMPANY_ID", "PILIBALA_RUN_ID", "PILIBALA_TASK_ID",
]);
const PUBLIC_BOOLEAN_ENV_KEYS = new Set([
  "OPENCODE_ALLOW_ALL_MODELS", "CLAUDE_CODE_USE_BEDROCK", "GOOGLE_GENAI_USE_GCA",
  "CI", "NO_COLOR", "FORCE_COLOR",
]);

function isPublicBooleanSetting(key: string, value: string): boolean {
  return PUBLIC_BOOLEAN_ENV_KEYS.has(key.toUpperCase()) && /^(?:0|1|true|false)$/i.test(value);
}

/** Keep provider diagnostics in the run, after redaction and before truncation. */
export function sanitizeTerminalSessionFailure(
  failure: AcpxTerminalSessionFailure,
  env: Record<string, string>,
  authToken?: string,
  configuredEnv: Record<string, unknown> = {},
): AcpxTerminalSessionFailureDiagnostic {
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && !PUBLIC_ENV_KEYS.has(key.toUpperCase()) && !isPublicBooleanSetting(key, value))
    .map(([, value]) => value);
  // Configured values can be resolved secret_refs under arbitrary names (for
  // example DATABASE_URL). Key-name heuristics cannot establish they are public.
  for (const [key, value] of Object.entries(configuredEnv)) {
    if (typeof value === "string" && value && !isPublicBooleanSetting(key, value)) secrets.push(value);
  }
  // A provider may echo just the password from a configured connection URL.
  for (const value of Object.values(env)) {
    try {
      const url = new URL(value);
      if (url.password) {
        secrets.push(value, url.password, decodeURIComponent(url.password));
      }
    } catch { /* ordinary environment values are not URLs */ }
  }
  if (authToken) secrets.push(authToken);
  const secretForms = [...new Set(secrets.flatMap((value) => {
    const forms = [value, JSON.stringify(value).slice(1, -1)];
    // A malformed Unicode credential must not discard the entire diagnostic.
    try { forms.push(encodeURIComponent(value)); } catch { /* retain literal forms */ }
    return forms;
  }))].sort((a, b) => b.length - a.length);
  // Replace in one pass so a short value cannot modify a redaction marker
  // inserted for a longer value or cause repeated marker expansion.
  const secretPattern = secretForms.length > 0
    ? new RegExp(secretForms.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu")
    : null;
  const diagnostic: AcpxTerminalSessionFailureDiagnostic = {
    category: CATEGORIES.has(failure.category) ? failure.category : "unknown",
  };
  for (const field of ["title", "details"] as const) {
    const raw = failure[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    let text = secretPattern ? raw.replace(secretPattern, () => REDACTED_COMMAND_TEXT_VALUE) : raw;
    text = redactDiagnosticText(text)
      // Keep line breaks and tabs for provider JSON and stack traces, but strip
      // terminal control sequences and characters PostgreSQL cannot store.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .replace(/[\ud800-\udfff]/gu, "\ufffd")
      .trim();
    const limit = FIELD_LIMITS[field];
    if (text.length > limit) {
      (diagnostic.truncatedFields ??= []).push(field);
      // Do not split a UTF-16 surrogate pair into invalid JSONB text.
      const end = (text.codePointAt(limit - 1) ?? 0) > 0xffff ? limit - 1 : limit;
      text = `${text.slice(0, end)}\n[truncated: ${text.length - end} characters omitted]`;
    }
    if (text) diagnostic[field] = text;
  }
  return diagnostic;
}

export function formatTerminalSessionFailure(
  message: string | null,
  diagnostic: AcpxTerminalSessionFailureDiagnostic | null,
): string | null {
  if (!diagnostic) return message;
  return [...new Set([message, diagnostic.title, diagnostic.details].filter(Boolean))].join("\n");
}

/** Resume-refusal runs auto-heal on the next attempt: the engine clears the
 * dead session (`clearSession`) and the retry bootstraps a fresh one with the
 * full task conversation replayed, so the user-facing message must say what
 * happens next instead of surfacing the raw gateway refusal (observed
 * 2026-11-04: "Persistent ACP session … could not be resumed: Internal error"
 * with no guidance — hermes daemon refuses session.resume with a bare
 * storage_unavailable for both resume and load). Keep the raw text below the
 * guidance: the run log and the recovery classification still need it. */
export function formatSessionResumeRefusalFailure(
  message: string | null,
  diagnostic: AcpxTerminalSessionFailureDiagnostic | null,
): string {
  const detail = [...new Set([message, diagnostic?.title, diagnostic?.details].filter(Boolean))].join("\n");
  return [
    "会话恢复失败（agent 网关拒绝续传已有会话）。系统已自动重置会话：重新发送消息即可继续，新会话会重发完整任务对话，不会丢失任务上下文。",
    "Session restore was refused by the agent gateway. The session has been reset — resend your message to continue (the full task conversation is replayed into the new session).",
    detail,
  ].filter(Boolean).join("\n");
}
