import { describe, expect, it } from "vitest";
import { buildTranscript, createTranscriptBuilder, type RunLogChunk } from "./transcript";
import { grokLocalUIAdapter } from "./grok-local";
import { kimiLocalUIAdapter } from "./kimi-local";
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
