import { redactHomePathUserSegments, redactTranscriptEntryPaths } from "@pilibalaai/adapter-utils";
import type { TranscriptEntry, StdoutLineParser, TranscriptParserSource } from "./types";

export type RunLogChunk = { ts: string; stream: "stdout" | "stderr" | "system"; chunk: string; seq?: number };
type TranscriptBuildOptions = { censorUsernameInLogs?: boolean; quiet?: boolean };
type RedactionOptions = { enabled: boolean };

/**
 * Quiet-output control for transcripts, mirroring the Agent adapterConfig
 * `quiet` / `verbose` toggles. These are presentation-only controls: they
 * change how much transcript detail the UI shows, never what the agent
 * executes. `verbose` wins over `quiet` when both are set.
 */
export function quietTranscriptFromAdapterConfig(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const record = config as Record<string, unknown>;
  if (record.verbose === true) return false;
  return record.quiet === true;
}

/**
 * Quiet-output transform. Per the presentation contract, quiet output keeps
 * the progress hints (thinking happened, tools ran) but strips their CONTENT,
 * so a reader sees that work is advancing without the full log volume:
 * - thinking → text-less lifecycle row (renders as "Thought"/"Thinking…")
 * - tool_result → status only (✓/✗ row keeps name + short target, drops the
 *   output body that floods the transcript)
 * tool_call entries stay intact — the call's short target (command, file
 * path) IS the action hint. Approval/permission prompts
 * (`runtime_request`) are always kept — silencing them would block runs.
 */
function quietTransformTranscriptEntry(entry: TranscriptEntry): TranscriptEntry {
  if (entry.kind === "thinking") {
    return entry.text ? { ...entry, text: "" } : entry;
  }
  if (entry.kind === "tool_result") {
    return entry.content ? { ...entry, content: "" } : entry;
  }
  return entry;
}

/**
 * Extract complete top-level JSON values from a buffered stdout string.
 *
 * ACP-lane runtime events (`acpx.*`) arrive as one compact JSON object per
 * stdout line, and the persisted log / websocket chunk strips the trailing
 * newline (it was consumed as the line delimiter). Newline-based buffering
 * therefore holds the whole event stream as one "incomplete" line until an
 * unrelated newline-bearing chunk arrives — then flushes the concatenation as
 * a single unparseable line, collapsing every thought delta into one assistant
 * entry and hiding tool calls entirely (so the quiet filter has nothing to
 * hide on ACP transcripts). Returns null when the buffer does not start a JSON
 * value, so plain-text streams keep the newline-based buffering.
 */
function takeBufferedStdoutLines(
  buffer: string,
): { lines: string[]; rest: string } | null {
  const leading = buffer.length - buffer.trimStart().length;
  const first = buffer[leading];
  if (first !== "{" && first !== "[") return null;
  const lines: string[] = [];
  let depth = 0;
  let start = leading;
  let inString = false;
  let escape = false;
  for (let i = start; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        while (
          end < buffer.length &&
          (buffer[end] === "\n" || buffer[end] === "\r" || buffer[end] === " " || buffer[end] === "\t")
        ) {
          end++;
        }
        lines.push(buffer.slice(start, end));
        start = end;
        const restTrimmed = buffer.slice(start).trimStart();
        if (restTrimmed && !restTrimmed.startsWith("{") && !restTrimmed.startsWith("[")) break;
      }
    }
  }
  return { lines, rest: start < buffer.length ? buffer.slice(start) : "" };
}

function resolveStdoutParser(source: StdoutLineParser | TranscriptParserSource) {
  if (typeof source === "function") {
    return { parseLine: source, reset: null as (() => void) | null };
  }
  if (source.createStdoutParser) {
    const parser = source.createStdoutParser();
    return { parseLine: parser.parseLine, reset: parser.reset };
  }
  return { parseLine: source.parseStdoutLine, reset: null as (() => void) | null };
}

export type TranscriptAppendResult = { appended: number; mutated: boolean };

export function appendTranscriptEntry(entries: TranscriptEntry[], entry: TranscriptEntry): TranscriptAppendResult {
  if ((entry.kind === "thinking" || entry.kind === "assistant") && entry.delta) {
    const last = entries[entries.length - 1];
    if (
      last &&
      last.kind === entry.kind &&
      last.delta &&
      last.channel === entry.channel
    ) {
      // Delta coalescing mutates the existing entry in place — the entries
      // array does not grow, but the visible transcript did change. An empty
      // delta (quiet mode strips thinking/tool content before coalescing)
      // changes nothing visible: report no mutation so callers can skip the
      // re-render entirely.
      last.text += entry.text;
      last.ts = entry.ts;
      return { appended: 0, mutated: entry.text !== "" };
    }
  }
  entries.push(entry);
  return { appended: 1, mutated: false };
}

export function appendTranscriptEntries(entries: TranscriptEntry[], incoming: TranscriptEntry[]): TranscriptAppendResult {
  let appended = 0;
  let mutated = false;
  for (const entry of incoming) {
    const result = appendTranscriptEntry(entries, entry);
    appended += result.appended;
    mutated ||= result.mutated;
  }
  return { appended, mutated };
}

function truncateTranscriptLine(line: string, maxLength = 160) {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 3)}...`;
}

function formatTranscriptParserError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function createTranscriptParseErrorEntry(
  line: string,
  ts: string,
  error: unknown,
  redactionOptions: RedactionOptions,
): TranscriptEntry {
  const errorText = formatTranscriptParserError(error) || "unknown parser error";
  const preview = truncateTranscriptLine(line);
  return {
    kind: "result",
    ts,
    text: redactHomePathUserSegments(
      `Chat transcript error: ${errorText}. Falling back for line: ${preview}`,
      redactionOptions,
    ),
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    subtype: "transcript_parse_error",
    isError: true,
    errors: [],
  };
}

function appendParsedTranscriptLine(args: {
  entries: TranscriptEntry[];
  line: string;
  ts: string;
  parseLine: (line: string, ts: string) => TranscriptEntry[];
  reset: (() => void) | null;
  redactionOptions: RedactionOptions;
  quiet?: boolean;
}): TranscriptAppendResult {
  const { entries, line, ts, parseLine, reset, redactionOptions, quiet } = args;
  try {
    const parsed = parseLine(line, ts);
    return appendTranscriptEntries(
      entries,
      (quiet ? parsed.map(quietTransformTranscriptEntry) : parsed).map((entry) =>
        redactTranscriptEntryPaths(entry, redactionOptions),
      ),
    );
  } catch (error) {
    reset?.();
    return appendTranscriptEntry(entries, createTranscriptParseErrorEntry(line, ts, error, redactionOptions));
  }
}

/**
 * Incremental transcript accumulator for live streaming.
 *
 * `buildTranscript` re-parses the entire chunk history on every call, which
 * turns a delta-streaming run (thousands of one-token chunks) into O(n²) parse
 * work — the dominant CPU cost on a busy task page. The builder parses each
 * chunk exactly once and appends the resulting entries into the same array the
 * consumer already holds, so a new chunk costs O(1) parse work instead of a
 * full rebuild.
 *
 * Semantics relative to `buildTranscript`:
 * - One parser instance is reused across appends. Stateless line parsers
 *   (hermes/acp/claude/grok/…) behave identically. A stateful
 *   `createStdoutParser` keeps its state across appends, which matches how the
 *   underlying stream actually arrives; `buildTranscript` resets per call only
 *   because it re-parses from scratch.
 * - An incomplete trailing stdout line stays in the buffer instead of being
 *   emitted immediately, so it is parsed once when completed by a later chunk.
 *   `flush()` emits it for a stream that ends without a newline (mirroring the
 *   trailing flush in `buildTranscript`).
 * - stderr/system chunks bypass the line parser exactly as in
 *   `buildTranscript`.
 */
export interface TranscriptBuilder {
  /** Entries accumulated so far; appended in place by `append`. */
  readonly entries: TranscriptEntry[];
  /**
   * Parse and append chunks. Returns what the visible transcript did:
   * `appended` counts entries pushed; `mutated` reports delta coalescing
   * (`last.text += entry.text`) that changed an existing entry without
   * pushing. `changed` is true when a consumer should re-render.
   */
  append(chunks: readonly RunLogChunk[]): { appended: number; mutated: boolean; changed: boolean };
  /** Emit a buffered incomplete trailing stdout line (stream ended). */
  flush(): { appended: number; mutated: boolean; changed: boolean };
  /** Release a stateful parser's accumulated state. */
  dispose(): void;
}

export function createTranscriptBuilder(
  parserSource: StdoutLineParser | TranscriptParserSource,
  opts?: TranscriptBuildOptions,
): TranscriptBuilder {
  const entries: TranscriptEntry[] = [];
  let stdoutBuffer = "";
  let lastStdoutTs = "";
  const redactionOptions = { enabled: opts?.censorUsernameInLogs ?? false };
  const quiet = opts?.quiet === true;
  const { parseLine, reset } = resolveStdoutParser(parserSource);

  const append = (chunks: readonly RunLogChunk[]): TranscriptAppendResult & { changed: boolean } => {
    let appended = 0;
    let mutated = false;
    for (const chunk of chunks) {
      if (chunk.stream === "stderr") {
        entries.push({ kind: "stderr", ts: chunk.ts, text: redactHomePathUserSegments(chunk.chunk, redactionOptions) });
        appended += 1;
        continue;
      }
      if (chunk.stream === "system") {
        entries.push({ kind: "system", ts: chunk.ts, text: redactHomePathUserSegments(chunk.chunk, redactionOptions) });
        appended += 1;
        continue;
      }
      lastStdoutTs = chunk.ts;

      const combined = stdoutBuffer + chunk.chunk;
      const emitLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return { appended: 0, mutated: false };
        return appendParsedTranscriptLine({
          entries,
          line: trimmed,
          ts: chunk.ts,
          parseLine,
          reset,
          redactionOptions,
          quiet,
        });
      };
      const bufferedJson = takeBufferedStdoutLines(combined);
      if (bufferedJson) {
        stdoutBuffer = bufferedJson.rest;
        for (const line of bufferedJson.lines) {
          const result = emitLine(line);
          appended += result.appended;
          mutated ||= result.mutated;
        }
      } else {
        const lines = combined.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const result = emitLine(line);
          appended += result.appended;
          mutated ||= result.mutated;
        }
      }
    }
    return { appended, mutated, changed: appended > 0 || mutated };
  };

  const flush = (): TranscriptAppendResult & { changed: boolean } => {
    const trailing = stdoutBuffer.trim();
    stdoutBuffer = "";
    if (!trailing) return { appended: 0, mutated: false, changed: false };
    const ts = lastStdoutTs || new Date().toISOString();
    const emitTrailing = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return { appended: 0, mutated: false };
      return appendParsedTranscriptLine({
        entries,
        line: trimmed,
        ts,
        parseLine,
        reset,
        redactionOptions,
        quiet,
      });
    };
    let appended = 0;
    let mutated = false;
    const bufferedJson = takeBufferedStdoutLines(trailing);
    if (bufferedJson) {
      for (const line of bufferedJson.lines) {
        const result = emitTrailing(line);
        appended += result.appended;
        mutated ||= result.mutated;
      }
      if (bufferedJson.rest.trim()) {
        const result = emitTrailing(bufferedJson.rest);
        appended += result.appended;
        mutated ||= result.mutated;
      }
    } else {
      const result = emitTrailing(trailing);
      appended += result.appended;
      mutated ||= result.mutated;
    }
    return { appended, mutated, changed: appended > 0 || mutated };
  };

  const dispose = () => {
    reset?.();
  };

  return { entries, append, flush, dispose };
}

export function buildTranscript(
  chunks: RunLogChunk[],
  parserSource: StdoutLineParser | TranscriptParserSource,
  opts?: TranscriptBuildOptions,
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let stdoutBuffer = "";
  const redactionOptions = { enabled: opts?.censorUsernameInLogs ?? false };
  const { parseLine, reset } = resolveStdoutParser(parserSource);

  const emit = (line: string, ts: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    appendParsedTranscriptLine({
      entries,
      line: trimmed,
      ts,
      parseLine,
      reset,
      redactionOptions,
      quiet: opts?.quiet === true,
    });
  };

  for (const chunk of chunks) {
    if (chunk.stream === "stderr") {
      entries.push({ kind: "stderr", ts: chunk.ts, text: redactHomePathUserSegments(chunk.chunk, redactionOptions) });
      continue;
    }
    if (chunk.stream === "system") {
      entries.push({ kind: "system", ts: chunk.ts, text: redactHomePathUserSegments(chunk.chunk, redactionOptions) });
      continue;
    }

    const combined = stdoutBuffer + chunk.chunk;
    const bufferedJson = takeBufferedStdoutLines(combined);
    if (bufferedJson) {
      stdoutBuffer = bufferedJson.rest;
      for (const line of bufferedJson.lines) emit(line, chunk.ts);
    } else {
      const lines = combined.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) emit(line, chunk.ts);
    }
  }

  const trailing = stdoutBuffer.trim();
  if (trailing) {
    const ts = chunks.length > 0 ? chunks[chunks.length - 1]!.ts : new Date().toISOString();
    const bufferedJson = takeBufferedStdoutLines(stdoutBuffer);
    if (bufferedJson) {
      for (const line of bufferedJson.lines) emit(line, ts);
      if (bufferedJson.rest.trim()) emit(bufferedJson.rest, ts);
    } else {
      emit(trailing, ts);
    }
  }

  reset?.();

  return entries;
}
