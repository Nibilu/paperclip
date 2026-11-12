/**
 * Strip ANSI escape sequences (CSI, OSC) from terminal text.
 * Same pattern used in claude-local adapter quota.ts.
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * Parse Hermes Agent stdout into TranscriptEntry objects for the Pilibala UI.
 *
 * Hermes CLI quiet-mode output patterns:
 *   Assistant:  "  ┊ 💬 {text}"
 *   Tool (TTY): "  ┊ {emoji} {verb:9} {detail}  {duration}"
 *   Tool (pipe): "  [done] ┊ {emoji} {verb:9} {detail}  {duration} ({total})"
 *   System:     "[hermes] ..."
 *
 * We emit structured tool_call/tool_result pairs so Pilibala renders proper
 * tool cards (with status icons, expand/collapse) instead of raw stdout blocks.
 */

import type { TranscriptEntry } from "@pilibalaai/adapter-utils";
import { parseAcpxStdoutLine } from "@pilibalaai/adapter-utils/acpx-engine/ui";

import { TOOL_OUTPUT_PREFIX } from "../shared/constants.js";

// ── Kaomoji / noise stripping ──────────────────────────────────────────────

/**
 * Strip kawaii faces and decorative emoji from a tool summary line.
 * Leaves meaningful emoji (💻 for terminal, 🔍 for search, etc.) intact
 * by only stripping parenthesized kaomoji like (｡◕‿◕｡).
 */
function stripKaomoji(text: string): string {
  // Strip parenthesized kaomoji faces: (｡◕‿◕｡), (★ω★), etc.
  return text.replace(/[(][^()]{2,20}[)]\s*/gu, "").trim();
}

// ── Line classification ────────────────────────────────────────────────────

/** Check if a ┊ line is an assistant message (┊ 💬 ...). */
function isAssistantToolLine(stripped: string): boolean {
  return /^┊\s*💬/.test(stripped);
}

/** Extract assistant text from a ┊ 💬 line. */
function extractAssistantText(line: string): string {
  return line.replace(/^[\s┊]*💬\s*/, "").trim();
}

/**
 * Parse a tool completion line into structured data.
 *
 * Handles both TTY and pipe formats:
 *   TTY:  ┊ 💻 $         curl -s "..."  0.1s
 *   Pipe: [done] ┊ 💻 $   curl -s "..."  0.1s (0.5s)
 */
function parseToolCompletionLine(
  line: string,
): { name: string; detail: string; duration: string; hasError: boolean } | null {
  // Strip leading whitespace and [done] prefix
  let cleaned = line.trim().replace(/^\[done\]\s*/, "");

  // Must start with ┊
  if (!cleaned.startsWith(TOOL_OUTPUT_PREFIX)) return null;

  // Remove ┊ prefix and any leading kaomoji face
  cleaned = cleaned.slice(TOOL_OUTPUT_PREFIX.length);
  cleaned = stripKaomoji(cleaned).trim();

  // Now format is: "{emoji} {verb:9} {detail}  {duration}" or "{emoji} {verb:9} {detail}  {duration} ({total})"
  // Example: "💻 $         curl -s ..." or "🔍 search    pattern  0.1s"
  // The verb+detail are separated by whitespace, duration is at the end

  // Match: emoji + verb + detail + duration
  // Duration pattern: N.Ns (possibly followed by (N.Ns))
  const durationMatch = cleaned.match(/([\d.]+s)\s*(?:\([\d.]+s\))?\s*$/);
  const duration = durationMatch ? durationMatch[1] : "";

  // Remove duration from the end to get verb + detail
  let verbAndDetail = durationMatch
    ? cleaned.slice(0, cleaned.lastIndexOf(durationMatch[0])).trim()
    : cleaned;
  verbAndDetail = verbAndDetail.replace(/^\p{Emoji_Presentation}\s*/u, "");

  // Check for error suffixes
  const hasError = /\[(?:exit \d+|error|full)\]/.test(verbAndDetail) ||
    /\[error\]\s*$/.test(cleaned);

  // The first token (after emoji) is the verb, rest is detail
  // Verbs are always a single word or symbol ($ for terminal)
  const parts = verbAndDetail.match(/^(\S+)\s+(.*)/);
  if (!parts) {
    return { name: "tool", detail: verbAndDetail, duration, hasError };
  }

  const verb = parts[1];
  const detail = parts[2].trim();

  // Map Hermes verbs to readable tool names
  const nameMap: Record<string, string> = {
    "$": "shell",
    "exec": "shell",
    "terminal": "shell",
    "search": "search",
    "fetch": "fetch",
    "crawl": "crawl",
    "navigate": "browser",
    "snapshot": "browser",
    "click": "browser",
    "type": "browser",
    "scroll": "browser",
    "back": "browser",
    "press": "browser",
    "close": "browser",
    "images": "browser",
    "vision": "browser",
    "read": "read",
    "write": "write",
    "patch": "patch",
    "grep": "search",
    "find": "search",
    "plan": "plan",
    "recall": "recall",
    "proc": "process",
    "delegate": "delegate",
    "todo": "todo",
    "memory": "memory",
    "clarify": "clarify",
    "session_search": "recall",
    "code": "execute",
    "execute": "execute",
    "web_search": "search",
    "web_extract": "fetch",
    "browser_navigate": "browser",
    "browser_click": "browser",
    "browser_type": "browser",
    "browser_snapshot": "browser",
    "browser_vision": "browser",
    "browser_scroll": "browser",
    "browser_press": "browser",
    "browser_back": "browser",
    "browser_close": "browser",
    "browser_get_images": "browser",
    "read_file": "read",
    "write_file": "write_file",
    "search_files": "search",
    "patch_file": "patch",
    "execute_code": "execute",
  };

  const name = nameMap[verb.toLowerCase()] || verb;

  return { name, detail, duration, hasError };
}

// ── Synthetic tool ID generation ────────────────────────────────────────────

let toolCallCounter = 0;

/**
 * Generate a synthetic toolUseId for pairing tool_call with tool_result.
 * Pilibala uses this to match them in normalizeTranscript.
 */
function syntheticToolUseId(): string {
  return `hermes-tool-${++toolCallCounter}`;
}

// ── Thinking detection ─────────────────────────────────────────────────────

function isThinkingLine(line: string): boolean {
  return (
    line.includes("💭") ||
    line.startsWith("<thinking>") ||
    line.startsWith("</thinking>") ||
    line.startsWith("Thinking:")
  );
}

// ── Main parser ────────────────────────────────────────────────────────────

/**
 * Classify a modern (non-quiet) Hermes CLI tool completion row.
 *
 * Grammar (hermes-agent cli_modern_layout.tool_row):
 *   {emoji|✗} {Verb} {detail}[  {N.N}s][ [exit N]]
 * e.g. `🐍 Exec import os, json  0.2s`, `💻 $ pytest -q  0.4s [exit 1]`,
 * `✗ Memory ? [quota]`. The verb is the (capitalized) tool verb, so the
 * classification is anchored on a curated verb whitelist plus tool emojis
 * to keep genuine model text out of the tool lane.
 *
 * @returns tool_call/tool_result pair, or null when the line is not a row.
 */
const MODERN_TOOL_ROW_RE = /^(\p{Extended_Pictographic}\uFE0F?|✗) ([^ ]{1,14})(?: (.*))?$/u;

const MODERN_TOOL_ROW_VERBS = new Set([
  "$", "exec", "read", "write", "edit", "patch", "find", "grep", "search",
  "recall", "browse", "navigate", "click", "type", "scroll", "back", "press",
  "snapshot", "images", "vision", "fetch", "skills", "skill", "cron", "proc",
  "delegate", "memory", "create", "speak", "send", "tasks", "terminal", "ask",
  "running", "loading", "listing", "updating", "scheduling", "delegating",
  "generating", "reading", "writing", "editing", "planning", "completed",
]);

const MODERN_TOOL_EMOJI_NAMES: Record<string, string> = {
  "🐍": "execute_code",
  "💻": "terminal",
  "📖": "read_file",
  "✍": "write_file",
  "🔧": "patch",
  "🔎": "search_files",
  "🔍": "web_search",
  "📄": "web_extract",
  "⚙": "process_manage",
  "🧠": "memory",
  "📚": "skills",
  "🎨": "image_generate",
  "🔊": "text_to_speech",
  "📨": "send_message",
  "⏰": "cronjob_manage",
  "🔀": "delegate_task",
  "👁": "vision_analyze",
  "🌐": "browser",
  "📸": "browser_snapshot",
  "👆": "browser_click",
  "⌨": "browser_type",
  "◀": "browser_back",
  "🖼": "browser_get_images",
  "⚡": "tool",
};

// On failure the CLI replaces the tool's emoji with a red ✗, so the tool
// must be recovered from the verb (cli_modern_layout.tool_row).
const MODERN_ERROR_ROW_TOOL_BY_VERB: Record<string, string> = {
  "$": "terminal",
  exec: "execute_code",
  read: "read_file",
  write: "write_file",
  edit: "patch",
  patch: "patch",
  find: "search_files",
  grep: "search_files",
  search: "web_search",
  recall: "session_search",
  browse: "browser",
  navigate: "browser",
  snapshot: "browser_snapshot",
  click: "browser_click",
  type: "browser_type",
  press: "browser_type",
  scroll: "browser",
  back: "browser",
  images: "browser_get_images",
  vision: "vision_analyze",
  fetch: "web_extract",
  proc: "process_manage",
  skills: "skills_list",
  skill: "skill_view",
  cron: "cronjob_manage",
  delegate: "delegate_task",
  memory: "memory",
  create: "image_generate",
  speak: "text_to_speech",
  send: "send_message",
  terminal: "terminal",
};

function parseModernHermesToolRow(
  line: string,
  ts: string,
): TranscriptEntry[] | null {
  const match = MODERN_TOOL_ROW_RE.exec(line);
  if (!match) return null;
  const [, markRaw, verbRaw, detailRaw = ""] = match;
  const mark = markRaw.replace(/\uFE0F/g, "");
  const verb = verbRaw.toLowerCase();
  const isError = mark === "✗";
  const toolName = isError ? MODERN_ERROR_ROW_TOOL_BY_VERB[verb] : MODERN_TOOL_EMOJI_NAMES[mark];
  if (!toolName) return null;
  if (!MODERN_TOOL_ROW_VERBS.has(verb)) return null;
  const hasDuration = /\s\d+(?:\.\d+)?s$/.test(detailRaw);
  const hasExitSuffix = /\s\[exit \d+\]$/.test(detailRaw);
  // Non-error rows must carry a duration or exit suffix; error rows are
  // anchored by the ✗ mark plus the verb whitelist above.
  if (!isError && !hasDuration && !hasExitSuffix) return null;

  const durationMatch = hasDuration ? /(\d+(?:\.\d+)?)s$/.exec(detailRaw) : null;
  const detail = detailRaw
    .replace(/\s\d+(?:\.\d+)?s$/, "")
    .replace(/\s\[exit \d+\]$/, "")
    .trim();
  const id = syntheticToolUseId();
  const resultText = durationMatch ? `${detail}  ${durationMatch[1]}s` : detail;
  return [
    {
      kind: "tool_call" as const,
      ts,
      name: toolName,
      input: { detail },
      toolUseId: id,
    },
    {
      kind: "tool_result" as const,
      ts,
      toolUseId: id,
      content: resultText,
      isError,
    },
  ] as TranscriptEntry[];
}

/**
 * Parse a single line of Hermes stdout into transcript entries.
 *
 * Emits structured tool_call/tool_result pairs (with synthetic IDs) so
 * Pilibala renders proper tool cards with status icons and expand/collapse.
 *
 * @param line  Raw stdout line from Hermes CLI
 * @param ts    ISO timestamp for the entry
 * @returns     Array of TranscriptEntry objects (may be empty)
 */
export function parseHermesStdoutLine(
  line: string,
  ts: string,
): TranscriptEntry[] {
  const trimmed = stripAnsi(line).trim();
  if (!trimmed) return [];

  // ── ACP-lane (acpx engine) events ─────────────────────────────────────
  // Hermes runs executed through the shared acpx engine (adapter engine=acp)
  // emit one JSON line per runtime event (acpx.text_delta with a
  // thought/output channel, acpx.tool_call lifecycle, acpx.result, …).
  // Delegate them to the shared acpx transcript parser so streamed text is
  // coalesced into thinking/assistant entries (delta:true) instead of
  // falling through to one raw-JSON assistant entry per line.
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { type?: unknown };
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string" && parsed.type.startsWith("acpx.")) {
        return parseAcpxStdoutLine(trimmed, ts);
      }
    } catch {
      // Corrupted acpx event line (legacy redaction broke the JSON structure):
      // surface it as a neutral system note so historical logs never read as
      // agent message output. The raw line stays in the persisted log.
      if (trimmed.includes('"type":"acpx.')) {
        return [{
          kind: "system" as const,
          ts,
          text: `[corrupted acpx event] ${trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed}`,
        }];
      }
      // Not JSON — fall through to the Hermes CLI line grammar below.
    }
  }

  // ── System/adapter messages ────────────────────────────────────────────
  if (trimmed.startsWith("[hermes]") || trimmed.startsWith("[pilibala]")) {
    return [{ kind: "system", ts, text: trimmed }];
  }

  // ── Non-quiet mode tool start lines: [tool] (kaomoji) emoji verb ... ──
  // These are redundant — the tool_call/tool_result pair arrives later from
  // the ┊ completion line. Skip them to avoid duplicate entries.
  if (trimmed.startsWith("[tool]")) {
    return [];
  }

  // ── MCP / server init noise reclassified from stderr by wrappedOnLog ──
  // Pattern: [2026-03-25T10:40:53.941Z] INFO: ...
  // Emit as stderr so Pilibala groups them into the amber accordion.
  if (/^\[\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return [{ kind: "stderr", ts, text: trimmed }];
  }

  // ── Standalone spinner remnants: "💻 Completed", "💻\nCompleted", etc. ─
  // These are non-quiet mode spinner frame leftovers — skip them.
  if (/^\p{Emoji_Presentation}\s*(Completed|Running|Error)?\s*$/u.test(trimmed)) {
    return [];
  }

  // ── Lifecycle status lines (AMB-254 follow-up C3) ─────────────────────
  // The CLI prints lifecycle notices (memory provider, compaction) to stdout
  // via _emit_status. They are NOT model text: without a dedicated rule they
  // land in the assistant catch-all and read as the agent speaking.
  if (/^👁️ Hindsight — /.test(trimmed) || /^✓ Context compaction complete/.test(trimmed)) {
    return [{ kind: "system", ts, text: trimmed }];
  }

  // ── Modern tool completion rows (non-quiet Hermes CLI) ─────────────────
  // The current CLI (cli_modern_layout.tool_row) prints finished calls as
  //   {emoji|✗} {Verb} {detail}[  {N.N}s][ [exit N]]
  // with no ┊ prefix, so the legacy ┊ handling never matches and every row
  // falls into the assistant catch-all (AMB-261 evidence: `🐍 Exec … 0.2s`,
  // `✗ Memory ? […]`).
  const toolRow = parseModernHermesToolRow(trimmed, ts);
  if (toolRow) return toolRow;

  // ── Session info line ────────────────────────────────────────────────
  if (trimmed.startsWith("session_id:")) {
    return [{ kind: "system", ts, text: trimmed }];
  }

  // ── Quiet-mode tool/message lines (prefixed with ┊) ────────────────────
  if (trimmed.includes(TOOL_OUTPUT_PREFIX)) {
    // Assistant message: ┊ 💬 {text}
    if (isAssistantToolLine(trimmed)) {
      return [{ kind: "assistant", ts, text: extractAssistantText(trimmed) }];
    }

    // Tool completion: ┊ {emoji} {verb} {detail} {duration}
    const toolInfo = parseToolCompletionLine(trimmed);
    if (toolInfo) {
      const id = syntheticToolUseId();
      const detailText = toolInfo.duration
        ? `${toolInfo.detail}  ${toolInfo.duration}`
        : toolInfo.detail;

      return [
        {
          kind: "tool_call" as const,
          ts,
          name: toolInfo.name,
          input: { detail: toolInfo.detail },
          toolUseId: id,
        },
        {
          kind: "tool_result" as const,
          ts,
          toolUseId: id,
          content: detailText,
          isError: toolInfo.hasError,
        },
      ] as TranscriptEntry[];
    }

    // Fallback: raw ┊ line that doesn't match tool format
    const stripped = trimmed
      .replace(/^\[done\]\s*/, "")
      .replace(new RegExp(`^${TOOL_OUTPUT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "")
      .trim();
    return [{ kind: "stdout", ts, text: stripped }];
  }

  // ── Thinking blocks ────────────────────────────────────────────────────
  if (isThinkingLine(trimmed)) {
    return [
      {
        kind: "thinking",
        ts,
        text: trimmed.replace(/^💭\s*/, ""),
      },
    ];
  }

  // ── Error output ───────────────────────────────────────────────────────
  if (
    trimmed.startsWith("Error:") ||
    trimmed.startsWith("ERROR:") ||
    trimmed.startsWith("Traceback")
  ) {
    return [{ kind: "stderr", ts, text: trimmed }];
  }

  // ── Regular assistant output ───────────────────────────────────────────
  return [{ kind: "assistant", ts, text: trimmed }];
}
