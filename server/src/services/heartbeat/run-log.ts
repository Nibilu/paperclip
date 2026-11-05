import { appendWithByteCap, MAX_EXCERPT_BYTES, parseObject } from "../../adapters/utils.js";
import { redactSensitiveText } from "../../redaction.js";

const MAX_PERSISTED_LOG_CHUNK_CHARS = 64 * 1024;
const MAX_RUN_EVENT_PAYLOAD_STRING_CHARS = 16 * 1024;
const MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS = 50;
const MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS = 100;
const MAX_RUN_EVENT_PAYLOAD_DEPTH = 6;
const INLINE_BASE64_IMAGE_DATA_RE =
  /("type":"image","source":\{"type":"base64","data":")([A-Za-z0-9+/=]{1024,})(")/g;

export function appendExcerpt(prev: string, chunk: string) {
  return appendWithByteCap(prev, chunk, MAX_EXCERPT_BYTES);
}

function truncateRunEventString(value: string) {
  if (value.length <= MAX_RUN_EVENT_PAYLOAD_STRING_CHARS) return value;
  const omittedChars = value.length - MAX_RUN_EVENT_PAYLOAD_STRING_CHARS;
  return `${value.slice(0, MAX_RUN_EVENT_PAYLOAD_STRING_CHARS)}\n[truncated ${omittedChars} chars]`;
}

function boundRunEventValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return truncateRunEventString(value);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_RUN_EVENT_PAYLOAD_DEPTH) {
      return {
        _truncated: true,
        type: "array",
        originalLength: value.length,
      };
    }
    const bounded = value
      .slice(0, MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS)
      .map((entry) => boundRunEventValue(entry, depth + 1, seen));
    if (value.length > MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS) {
      bounded.push({
        _truncated: true,
        omittedItems: value.length - MAX_RUN_EVENT_PAYLOAD_ARRAY_ITEMS,
      });
    }
    return bounded;
  }
  if (typeof value !== "object" || value === undefined) {
    return null;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  const entries = Object.entries(value as Record<string, unknown>);
  if (depth >= MAX_RUN_EVENT_PAYLOAD_DEPTH) {
    const bounded = {
      _truncated: true,
      type: "object",
      keys: entries.map(([key]) => key).slice(0, 20),
    };
    seen.delete(value);
    return bounded;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(
    0,
    MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS,
  )) {
    out[key] = boundRunEventValue(entryValue, depth + 1, seen);
  }
  if (entries.length > MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS) {
    out._truncated = true;
    out._omittedKeys = entries.length - MAX_RUN_EVENT_PAYLOAD_OBJECT_KEYS;
  }
  seen.delete(value);
  return out;
}

export function boundHeartbeatRunEventPayloadForStorage(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const bounded = boundRunEventValue(payload, 0, new WeakSet());
  return parseObject(bounded) ?? { _truncated: true };
}

function redactInlineBase64ImageData(chunk: string) {
  return chunk.replace(
    INLINE_BASE64_IMAGE_DATA_RE,
    (_match, prefix: string, data: string, suffix: string) =>
      `${prefix}[omitted base64 image data: ${data.length} chars]${suffix}`,
  );
}

// Redact inside the string leaves of a parsed JSON value. Value-level redaction
// can never consume structural quotes/field separators, which is how the legacy
// text-level regex corrupted persisted JSONL (AMB-86 / AMB-171: a credential
// value ending at the text-field boundary swallowed the closing quote plus the
// `","` separator, and the broken line leaked raw into the UI transcript).
function redactJsonLeafStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonLeafStrings(entry));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactJsonLeafStrings(entry);
    }
    return out;
  }
  return value;
}

// Redact one log line as JSON; null when the line is not a JSON value.
function tryRedactJsonLogLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return JSON.stringify(redactJsonLeafStrings(parsed));
  } catch {
    return null;
  }
}

// JSON-aware redaction for run log chunks. Adapter event chunks are JSON
// values (one event per onLog call); redacting their string leaves and
// re-serializing keeps every persisted line parseable. Any non-JSON chunk
// (plain stderr text, multi-line freeform output) keeps the legacy
// text-level redaction path.
function redactChunkPreservingStructure(chunk: string): string {
  // Base64 image payloads are replaced at raw-chunk level first: the regex is
  // anchored to the JSON field shape and preserves its prefix/suffix, so the
  // chunk still parses as JSON afterwards.
  const base64Redacted = redactInlineBase64ImageData(chunk);
  const whole = tryRedactJsonLogLine(base64Redacted);
  if (whole !== null) return whole;

  const lines = base64Redacted.split("\n");
  const redactedLines: string[] = [];
  let jsonLineCount = 0;
  for (const line of lines) {
    if (!line.trim()) {
      redactedLines.push(line);
      continue;
    }
    const mapped = tryRedactJsonLogLine(line);
    if (mapped === null) {
      return redactSensitiveText(base64Redacted);
    }
    redactedLines.push(mapped);
    jsonLineCount += 1;
  }
  if (jsonLineCount === 0) {
    return redactSensitiveText(base64Redacted);
  }
  return redactedLines.join("\n");
}

export function compactRunLogChunk(
  chunk: string,
  maxChars = MAX_PERSISTED_LOG_CHUNK_CHARS,
) {
  const normalized = redactChunkPreservingStructure(chunk);
  if (normalized.length <= maxChars) return normalized;

  const headChars = Math.max(0, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(0, Math.floor(maxChars * 0.25));
  const omittedChars = Math.max(0, normalized.length - headChars - tailChars);
  const marker = `\n[pilibala truncated run log chunk: omitted ${omittedChars} chars]\n`;
  return `${normalized.slice(0, headChars)}${marker}${normalized.slice(normalized.length - tailChars)}`;
}

