import { describe, expect, it } from "vitest";
import { buildTranscript, createTranscriptBuilder, quietTranscriptFromAdapterConfig, type RunLogChunk } from "./transcript";
import { grokLocalUIAdapter } from "./grok-local";
import { kimiLocalUIAdapter } from "./kimi-local";
import { hermesGatewayUIAdapter } from "./hermes-gateway";
import { parseStdoutLine as parseHermesGatewayStdoutLine } from "@pilibalaai/hermes-pilibala-adapter/gateway/ui";
import type { TranscriptEntry } from "./types";
import type { UIAdapterModule } from "./types";

describe("buildTranscript", () => {
  const ts = "2026-03-20T13:00:00.000Z";
  const chunks: RunLogChunk[] = [
    { ts, stream: "stdout", chunk: "opened /Users/dotta/project\n" },
    { ts, stream: "stderr", chunk: "stderr /Users/dotta/project" },
  ];

  it("defaults username censoring to off when options are omitted", () => {
    const entries = buildTranscript(chunks, (line, entryTs) => [{ kind: "stdout", ts: entryTs, text: line }]);

    expect(entries).toEqual([
      { kind: "stdout", ts, text: "opened /Users/dotta/project" },
      { kind: "stderr", ts, text: "stderr /Users/dotta/project" },
    ]);
  });

  it("still redacts usernames when explicitly enabled", () => {
    const entries = buildTranscript(chunks, (line, entryTs) => [{ kind: "stdout", ts: entryTs, text: line }], {
      censorUsernameInLogs: true,
    });

    expect(entries).toEqual([
      { kind: "stdout", ts, text: "opened /Users/d****/project" },
      { kind: "stderr", ts, text: "stderr /Users/d****/project" },
    ]);
  });

  it("creates a fresh stateful parser for each transcript build", () => {
    const statefulAdapter: UIAdapterModule = {
      type: "stateful_test",
      label: "Stateful Test",
      parseStdoutLine: (line, entryTs) => [{ kind: "stdout", ts: entryTs, text: line }],
      createStdoutParser: () => {
        let pending: string | null = null;
        return {
          parseLine: (line, entryTs) => {
            if (line.startsWith("begin:")) {
              pending = line.slice("begin:".length);
              return [];
            }
            if (line === "finish" && pending) {
              const text = `completed:${pending}`;
              pending = null;
              return [{ kind: "stdout", ts: entryTs, text }];
            }
            return [{ kind: "stdout", ts: entryTs, text: `literal:${line}` }];
          },
          reset: () => {
            pending = null;
          },
        };
      },
      ConfigFields: () => null,
      buildAdapterConfig: () => ({}),
    };

    const first = buildTranscript(
      [{ ts, stream: "stdout", chunk: "begin:task-a\n" }],
      statefulAdapter,
    );
    const second = buildTranscript(
      [{ ts, stream: "stdout", chunk: "finish\n" }],
      statefulAdapter,
    );

    expect(first).toEqual([]);
    expect(second).toEqual([{ kind: "stdout", ts, text: "literal:finish" }]);
  });

  it("converts parser failures into transcript error entries and keeps going", () => {
    const entries = buildTranscript(
      [
        { ts, stream: "stdout", chunk: "ok\nexplode\nlater\n" },
      ],
      (line, entryTs) => {
        if (line === "explode") {
          throw new Error("boom");
        }
        return [{ kind: "stdout", ts: entryTs, text: line }];
      },
    );

    expect(entries).toEqual([
      { kind: "stdout", ts, text: "ok" },
      {
        kind: "result",
        ts,
        text: "Chat transcript error: boom. Falling back for line: explode",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "transcript_parse_error",
        isError: true,
        errors: [],
      },
      { kind: "stdout", ts, text: "later" },
    ]);
  });

  it("resets stateful parsers after a failure before parsing later lines", () => {
    const statefulAdapter: UIAdapterModule = {
      type: "stateful_test",
      label: "Stateful Test",
      parseStdoutLine: (line, entryTs) => [{ kind: "stdout", ts: entryTs, text: line }],
      createStdoutParser: () => {
        let pending: string | null = null;
        return {
          parseLine: (line, entryTs) => {
            if (line.startsWith("begin:")) {
              pending = line.slice("begin:".length);
              return [];
            }
            if (line === "explode") {
              throw new Error(`bad state:${pending ?? "none"}`);
            }
            if (line === "finish" && pending) {
              const text = `completed:${pending}`;
              pending = null;
              return [{ kind: "stdout", ts: entryTs, text }];
            }
            return [{ kind: "stdout", ts: entryTs, text: `literal:${line}` }];
          },
          reset: () => {
            pending = null;
          },
        };
      },
      ConfigFields: () => null,
      buildAdapterConfig: () => ({}),
    };

    const entries = buildTranscript(
      [{ ts, stream: "stdout", chunk: "begin:task-a\nexplode\nfinish\n" }],
      statefulAdapter,
    );

    expect(entries).toEqual([
      {
        kind: "result",
        ts,
        text: "Chat transcript error: bad state:task-a. Falling back for line: explode",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "transcript_parse_error",
        isError: true,
        errors: [],
      },
      { kind: "stdout", ts, text: "literal:finish" },
    ]);
  });

  it("handles trailing buffered parser failures without throwing", () => {
    const entries = buildTranscript(
      [{ ts, stream: "stdout", chunk: "explode" }],
      (line, entryTs) => {
        if (line === "explode") {
          throw new Error("trailing boom");
        }
        return [{ kind: "stdout", ts: entryTs, text: line }];
      },
    );

    expect(entries).toEqual([
      {
        kind: "result",
        ts,
        text: "Chat transcript error: trailing boom. Falling back for line: explode",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "transcript_parse_error",
        isError: true,
        errors: [],
      },
    ]);
  });

  it("coalesces grok_local streaming text fragments into one assistant entry", () => {
    const entries = buildTranscript(
      [
        { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "text", data: "Hello " })}\n` },
        { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "text", data: "world" })}\n` },
        { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1" })}\n` },
      ],
      grokLocalUIAdapter,
    );

    expect(entries).toEqual([
      { kind: "assistant", ts, text: "Hello world", delta: true },
      { kind: "system", ts, text: "stop_reason=EndTurn session=sess-1" },
    ]);
  });

  it("coalesces kimi_local ACP text deltas into one assistant entry", () => {
    const entries = buildTranscript(
      [
        { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "acpx.text_delta", channel: "output", text: "Hello " })}\n` },
        { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "acpx.text_delta", channel: "output", text: "world" })}\n` },
        { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "acpx.result", summary: "done", stopReason: "end_turn" })}\n` },
      ],
      kimiLocalUIAdapter,
    );

    expect(entries).toEqual([
      { kind: "assistant", ts, text: "Hello world", delta: true },
      {
        kind: "result",
        ts,
        text: "done",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "end_turn",
        isError: false,
        errors: [],
      },
    ]);
  });
});

describe("createTranscriptBuilder (incremental streaming)", () => {
  const ts = "2026-03-20T13:00:00.000Z";

  const mixedChunks: RunLogChunk[] = [
    { ts, stream: "system", chunk: "[hermes] session started\n" },
    { ts, stream: "stderr", chunk: "warn /Users/dotta/project\n" },
    { ts, stream: "stdout", chunk: "first /Users/dotta/project\n" },
    { ts, stream: "stdout", chunk: "second" },
    { ts, stream: "stdout", chunk: " /Users/dotta/x tail\n" },
    { ts, stream: "stdout", chunk: "trailing-without-newline" },
  ];

  const lineParser = (line: string, entryTs: string) => [
    { kind: "stdout" as const, ts: entryTs, text: line },
  ];

  it("produces entries identical to buildTranscript for the same chunk stream", () => {
    const full = buildTranscript(mixedChunks, lineParser);
    const builder = createTranscriptBuilder(lineParser);
    // Feed one chunk at a time, as the live transports do.
    for (const chunk of mixedChunks) builder.append([chunk]);
    builder.flush();
    expect(builder.entries).toEqual(full);
  });

  it("produces entries identical to buildTranscript for a kimi ACP delta stream", () => {
    const deltaChunks: RunLogChunk[] = [
      { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "acpx.text_delta", channel: "output", text: "Hello " })}\n` },
      { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "acpx.text_delta", channel: "output", text: "world" })}\n` },
      { ts, stream: "stdout", chunk: `${JSON.stringify({ type: "acpx.result", summary: "done", stopReason: "end_turn" })}\n` },
    ];
    const full = buildTranscript(deltaChunks, kimiLocalUIAdapter);
    const builder = createTranscriptBuilder(kimiLocalUIAdapter);
    for (const chunk of deltaChunks) builder.append([chunk]);
    builder.flush();
    expect(builder.entries).toEqual(full);
  });

  it("buffers an incomplete trailing line until it is completed, then parses it once", () => {
    const builder = createTranscriptBuilder(lineParser);
    builder.append([{ ts, stream: "stdout", chunk: "partial-line" }]);
    // Not emitted yet — the line may still grow.
    expect(builder.entries).toEqual([]);

    builder.append([{ ts, stream: "stdout", chunk: " continued\nnext\n" }]);
    expect(builder.entries).toEqual([
      { kind: "stdout", ts, text: "partial-line continued" },
      { kind: "stdout", ts, text: "next" },
    ]);

    // Stream ends without a newline: flush emits the buffered tail exactly once.
    builder.append([{ ts, stream: "stdout", chunk: "tail" }]);
    builder.flush();
    builder.flush();
    expect(builder.entries).toEqual([
      { kind: "stdout", ts, text: "partial-line continued" },
      { kind: "stdout", ts, text: "next" },
      { kind: "stdout", ts, text: "tail" },
    ]);
  });

  it("keeps a stateful parser's state across appends (cross-append begin/finish pairing)", () => {
    const statefulAdapter: UIAdapterModule = {
      type: "stateful_incremental_test",
      label: "Stateful Incremental Test",
      parseStdoutLine: (line: string, entryTs: string) => [{ kind: "stdout", ts: entryTs, text: line }],
      createStdoutParser: () => {
        let pending: string | null = null;
        return {
          parseLine: (line: string, entryTs: string) => {
            if (line.startsWith("begin:")) {
              pending = line.slice("begin:".length);
              return [];
            }
            if (line === "finish" && pending) {
              const text = `completed:${pending}`;
              pending = null;
              return [{ kind: "stdout", ts: entryTs, text }];
            }
            return [{ kind: "stdout", ts: entryTs, text: `literal:${line}` }];
          },
          reset: () => {
            pending = null;
          },
        };
      },
      ConfigFields: () => null,
      buildAdapterConfig: () => ({}),
    } as unknown as UIAdapterModule;

    const builder = createTranscriptBuilder(statefulAdapter);
    builder.append([{ ts, stream: "stdout", chunk: "begin:task-1\n" }]);
    expect(builder.entries).toEqual([]);
    builder.append([{ ts, stream: "stdout", chunk: "finish\n" }]);
    expect(builder.entries).toEqual([{ kind: "stdout", ts, text: "completed:task-1" }]);
  });
});

  describe("quiet output control", () => {
    const ts = "2026-03-20T13:00:00.000Z";
    const acpLine = (raw: string) => JSON.stringify({ acpx: { type: raw } });
    const parser = (line: string, entryTs: string): TranscriptEntry[] => {
      if (line === "THINK") return [{ kind: "thinking", ts: entryTs, text: "hmm" }];
      if (line === "TOOL") return [{ kind: "tool_call", ts: entryTs, name: "read_file", input: {} }];
      if (line === "TOOLRES") return [{ kind: "tool_result", ts: entryTs, toolUseId: "t1", content: "ok", isError: false }];
      if (line === "PERM") return [{ kind: "runtime_request", ts: entryTs, requestId: "r1", requestKind: "permission_approval", turnId: null, requestType: "permission", status: "pending", prompt: "allow edit?", choices: [], fields: [] }];
      if (line === "SAY") return [{ kind: "assistant", ts: entryTs, text: "hello" }];
      if (line === "RES") return [{ kind: "result", ts: entryTs, text: "done", inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0, subtype: "success", isError: false, errors: [] }];
      return [];
    };
    const chunks = (lines: string[]): RunLogChunk[] => lines.map((l, i) => ({ ts: `${ts.slice(0, -1)}${i}`, stream: "stdout" as const, chunk: `${l}\n` }));

    it("quiet keeps thinking/tool progress hints but strips their content", () => {
      const entries = buildTranscript(chunks(["THINK", "TOOL", "TOOLRES", "PERM", "SAY", "RES"]), parser, { quiet: true });
      expect(entries.map((e) => e.kind)).toEqual(["thinking", "tool_call", "tool_result", "runtime_request", "assistant", "result"]);
      const thinking = entries[0] as Extract<TranscriptEntry, { kind: "thinking" }>;
      expect(thinking.text).toBe("");
      // The call's identity stays — it IS the action hint.
      const toolCall = entries[1] as Extract<TranscriptEntry, { kind: "tool_call" }>;
      expect(toolCall.name).toBe("read_file");
      const toolResult = entries[2] as Extract<TranscriptEntry, { kind: "tool_result" }>;
      expect(toolResult.content).toBe("");
      expect(toolResult.isError).toBe(false);
    });

    it("without quiet everything is kept", () => {
      const entries = buildTranscript(chunks(["THINK", "TOOL", "SAY"]), parser);
      expect(entries.map((e) => e.kind)).toEqual(["thinking", "tool_call", "assistant"]);
    });

    it("verbose overrides quiet", () => {
      expect(quietTranscriptFromAdapterConfig({ quiet: true, verbose: true })).toBe(false);
      expect(quietTranscriptFromAdapterConfig({ quiet: true })).toBe(true);
      expect(quietTranscriptFromAdapterConfig({})).toBe(false);
      expect(quietTranscriptFromAdapterConfig(null)).toBe(false);
    });

    it("createTranscriptBuilder honors quiet for appended chunks and the trailing flush", () => {
      const builder = createTranscriptBuilder(parser, { quiet: true });
      builder.append(chunks(["THINK", "SAY"]));
      builder.flush();
      expect(builder.entries.map((e) => e.kind)).toEqual(["thinking", "assistant"]);
      const thinking = builder.entries[0] as Extract<TranscriptEntry, { kind: "thinking" }>;
      expect(thinking.text).toBe("");
    });

    // AMB-174 regression: ACP runtime events persist/broadcast as one compact
    // JSON object per stdout chunk with the trailing newline already consumed
    // as the ndjson delimiter. Newline-based buffering used to hold the whole
    // event stream as one "incomplete" line, collapsing all thought deltas
    // into a single unparseable assistant entry — leaving the quiet toggle
    // nothing to hide on ACP transcripts.
    it("ACP newline-less JSON event chunks parse individually; quiet strips thought/tool-result content but keeps the hint rows", async () => {
      const { parseHermesStdoutLine } = await import("@pilibalaai/hermes-pilibala-adapter/ui");
      const event = (obj: Record<string, unknown>, i: number): RunLogChunk => ({
        ts: `${ts.slice(0, -1)}${i}`,
        stream: "stdout",
        chunk: JSON.stringify(obj),
      });
      const acpChunks = [
        event({ type: "acpx.text_delta", text: "pondering", channel: "thought", tag: "agent_thought_chunk" }, 0),
        event({ type: "acpx.text_delta", text: " more", channel: "thought", tag: "agent_thought_chunk" }, 1),
        event({ type: "acpx.tool_call", name: "read_file", status: "started", text: "reading x", toolUseId: "t1" }, 2),
        event({ type: "acpx.tool_call", name: "read_file", status: "completed", text: "done", toolUseId: "t1" }, 3),
        event({ type: "acpx.text_delta", text: "final answer", channel: "output" }, 4),
      ];
      const off = buildTranscript(acpChunks, parseHermesStdoutLine);
      expect(off.map((e) => e.kind)).toEqual(["thinking", "tool_call", "tool_call", "tool_result", "assistant"]);
      const on = buildTranscript(acpChunks, parseHermesStdoutLine, { quiet: true });
      expect(on.map((e) => e.kind)).toEqual(["thinking", "tool_call", "tool_call", "tool_result", "assistant"]);
      // Hint rows survive; the flooding content does not.
      const thought = on.find((e): e is Extract<TranscriptEntry, { kind: "thinking" }> => e.kind === "thinking");
      expect(thought?.text).toBe("");
      const toolResultEntry = on.find((e): e is Extract<TranscriptEntry, { kind: "tool_result" }> => e.kind === "tool_result");
      expect(toolResultEntry?.content).toBe("");

      // Same stream via the incremental builder (live websocket path).
      const builder = createTranscriptBuilder(parseHermesStdoutLine);
      for (const chunk of acpChunks) builder.append([chunk]);
      builder.flush();
      expect(builder.entries.map((e) => e.kind)).toEqual(["thinking", "tool_call", "tool_call", "tool_result", "assistant"]);
    });
  });

  describe("hermes-gateway SSE envelopes", () => {
    const gwChunk = (text: string, i: number): RunLogChunk => ({
      ts: `2026-03-20T13:00:00.00${i}Z`,
      stream: "stdout",
      chunk: text,
    });

    it("classifies envelope lines as thinking/tool cards instead of shredding them as JSON", () => {
      // Realistic gateway lane log: system prelude + SSE event envelopes.
      // The envelopes START with `[` (from "[hermes-gateway:event]") which used
      // to trip the JSON line-buffer's depth scanner and split every line at
      // bracket boundaries — leaking envelope fragments as stdout and breaking
      // tool-card classification.
      const gwChunks: RunLogChunk[] = [
        gwChunk("[hermes-gateway] run created: run_abc123\n", 0),
        gwChunk(
          '[hermes-gateway:event] run=run_abc123 event=message.delta data={"delta":"正在检查"}\n',
          1,
        ),
        gwChunk(
          '[hermes-gateway:event] run=run_abc123 event=message.delta data={"delta":"目录内容"}\n',
          2,
        ),
        gwChunk(
          '[hermes-gateway:event] run=run_abc123 event=tool.started data={"tool":"terminal","preview":"ls -la","tool_call_id":"call_1"}\n',
          3,
        ),
        gwChunk(
          '[hermes-gateway:event] run=run_abc123 event=tool.completed data={"tool":"terminal","duration":12,"error":false,"tool_call_id":"call_1","preview":"total 0"}\n',
          4,
        ),
        gwChunk(
          '[hermes-gateway:event] run=run_abc123 event=reasoning.available data={"text":"先看目录再回答"}\n',
          5,
        ),
        gwChunk(
          '[hermes-gateway:event] run=run_abc123 event=run.completed data={"output":"目录为空"}\n',
          6,
        ),
      ];

      const entries = buildTranscript(gwChunks, hermesGatewayUIAdapter, { quiet: false });

      const kinds = entries.map((e) => e.kind);
      expect(kinds).toContain("tool_call");
      expect(kinds).toContain("tool_result");
      expect(kinds).toContain("thinking");

      // Assistant deltas coalesce into ONE entry; no envelope text leaks.
      const assistant = entries.filter((e): e is Extract<TranscriptEntry, { kind: "assistant" }> => e.kind === "assistant");
      expect(assistant).toHaveLength(1);
      expect(assistant[0]!.text).toBe("正在检查目录内容");
      for (const entry of entries) {
        const text = entry.kind === "stdout" ? entry.text : entry.kind === "system" ? entry.text : "";
        expect(text).not.toContain("[hermes-gateway:event]");
      }

      const call = entries.find((e): e is Extract<TranscriptEntry, { kind: "tool_call" }> => e.kind === "tool_call");
      expect(call?.toolUseId).toBe("call_1");
      const result = entries.find((e): e is Extract<TranscriptEntry, { kind: "tool_result" }> => e.kind === "tool_result");
      expect(result?.toolUseId).toBe("call_1");
      expect(result?.content).toBe("total 0");
    });

    it("keeps bracket-opening plain text in the newline buffer without JSON.parse", () => {
      const bracketChunks: RunLogChunk[] = [
        gwChunk("[hermes-gateway:event] run=run_x event=tool.started data={\"tool\":\"terminal\",\"preview\":\"echo hi\",\"tool_call_id\":\"c9\"}\n", 0),
        gwChunk("[trailing plain line\n", 1),
      ];
      const entries = buildTranscript(bracketChunks, parseHermesGatewayStdoutLine, { quiet: false });
      expect(entries.map((e) => e.kind)).toEqual(["tool_call", "stdout"]);
      expect(entries[1]!.kind === "stdout" && entries[1]!.text).toBe("[trailing plain line");
    });
  });
