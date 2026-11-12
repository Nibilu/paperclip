import type { TranscriptEntry } from "@pilibalaai/adapter-utils";

import { shapeModernToolInput } from "../../ui/parse-stdout.js";

/**
 * Strip ANSI escape sequences (CSI, OSC) from terminal text.
 * Same pattern used in claude-local adapter quota.ts.
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Pull the reasoning text out of a `reasoning.available` event payload.
 * The exact field name is defined by the external Hermes gateway, so this
 * checks the plausible field names (mirroring the fallback chain used by
 * extractOutput() in gateway/server/execute.ts) and recurses one level into
 * nested `data` / `payload` records.
 */
function extractDirectReasoningText(data: Record<string, unknown>): string {
  return (
    asString(data.reasoning).trim() ||
    asString(data.reasoning_text).trim() ||
    asString(data.thinking).trim() ||
    asString(data.text).trim() ||
    asString(data.summary).trim() ||
    asString(data.content).trim()
  );
}

function extractReasoningText(data: Record<string, unknown> | null): string {
  if (!data) return "";
  const direct = extractDirectReasoningText(data);
  if (direct) return stripAnsi(direct);
  const nested = asRecord(data.data) ?? asRecord(data.payload);
  const nestedDirect = nested ? extractDirectReasoningText(nested) : "";
  return nestedDirect ? stripAnsi(nestedDirect) : "";
}

export function parseHermesGatewayStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const cleaned = stripAnsi(line);
  const trimmed = cleaned.trim();
  if (!trimmed) return [];

  const eventMatch = trimmed.match(/^\[hermes-gateway:event\]\s+run=([^\s]+)\s+event=([^\s]+)\s+data=(.*)$/s);
  if (eventMatch) {
    const eventName = eventMatch[2];
    const data = asRecord(safeJsonParse(eventMatch[3]));
    if (eventName === "message.delta") {
      const delta = asString(data?.delta) || asString(data?.text_delta);
      return delta ? [{ kind: "assistant", ts, text: stripAnsi(delta), delta: true }] : [];
    }
    if (eventName === "run.failed" || eventName === "run.error") {
      const message = asString(data?.error) || asString(data?.message) || "Hermes run failed";
      return [{ kind: "stderr", ts, text: message }];
    }
    if (eventName === "reasoning.available") {
      const reasoning = extractReasoningText(data);
      return [{ kind: "thinking", ts, text: reasoning || "Hermes reasoning available" }];
    }
    // ── Tool lifecycle → real tool cards (parity with the ACP lane) ────────
    // The gateway wire format carries structured fields per event
    // (gateway/platforms/api_server_runs.py _FIXED_EVENT_FIELDS):
    //   tool.started   {tool, preview, tool_call_id?}
    //   tool.completed {tool, duration, error, tool_call_id?, preview}
    // `preview` is the secret-redacted args/result summary (bounded to 500
    // chars server-side BEFORE truncation), so rendering it is safe.
    if (eventName === "tool.started") {
      const toolName = asString(data?.tool) || "gateway_tool";
      const toolUseId = asString(data?.tool_call_id) || toolName;
      const preview = stripAnsi(asString(data?.preview));
      return [{
        kind: "tool_call",
        ts,
        name: toolName,
        toolUseId,
        input: preview ? shapeModernToolInput(toolName, preview) : {},
      }];
    }
    if (eventName === "tool.completed") {
      const toolName = asString(data?.tool) || "gateway_tool";
      const toolUseId = asString(data?.tool_call_id) || toolName;
      const preview = stripAnsi(asString(data?.preview));
      const duration = Number(data?.duration);
      const durationText = Number.isFinite(duration) && duration > 0 ? `${duration}s` : "";
      return [{
        kind: "tool_result",
        ts,
        toolUseId,
        toolName,
        content: preview || durationText,
        isError: data?.error === true,
      }];
    }
    return [{ kind: "system", ts, text: `Hermes event: ${eventName}` }];
  }

  if (trimmed.startsWith("[hermes-gateway]")) {
    return [{ kind: "system", ts, text: trimmed.replace(/^\[hermes-gateway\]\s*/, "") }];
  }

  return [{ kind: "stdout", ts, text: cleaned }];
}
