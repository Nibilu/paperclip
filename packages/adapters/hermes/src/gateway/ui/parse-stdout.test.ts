import { describe, expect, it } from "vitest";
import { parseHermesGatewayStdoutLine } from "./parse-stdout.js";

const TS = "2026-07-08T12:00:00.000Z";

function eventLine(eventName: string, data: unknown): string {
  return `[hermes-gateway:event] run=run-123 event=${eventName} data=${JSON.stringify(data)}`;
}

describe("parseHermesGatewayStdoutLine — reasoning.available payload extraction", () => {
  // This is the assertion that FAILS on the old hardcoded-placeholder code
  // and PASSES once the real reasoning text is extracted from `data`.
  it("uses the real reasoning text from data.text instead of the hardcoded placeholder", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("reasoning.available", { text: "Considering three approaches to the cache invalidation bug." }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "thinking",
      ts: TS,
      text: "Considering three approaches to the cache invalidation bug.",
    });
    expect(result[0]).not.toHaveProperty("text", "Hermes reasoning available");
  });

  it("uses the real reasoning text from data.summary", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("reasoning.available", { summary: "Weighing tradeoffs between two refactor strategies." }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "thinking",
      ts: TS,
      text: "Weighing tradeoffs between two refactor strategies.",
    });
  });

  it("recurses one level into a nested data.data record to find the reasoning text", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("reasoning.available", { data: { text: "Nested reasoning payload from gateway wrapper." } }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "thinking",
      ts: TS,
      text: "Nested reasoning payload from gateway wrapper.",
    });
  });

  it("recurses one level into a nested data.payload record to find the reasoning text", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("reasoning.available", { payload: { reasoning: "Nested via payload wrapper instead of data." } }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "thinking",
      ts: TS,
      text: "Nested via payload wrapper instead of data.",
    });
  });

  it("falls back to the placeholder when data has no recognizable text field (preserves bare-signal behavior)", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("reasoning.available", { unrelatedField: 42 }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "thinking", ts: TS, text: "Hermes reasoning available" });
  });

  it("falls back to the placeholder when data is entirely absent/unparseable", () => {
    const result = parseHermesGatewayStdoutLine(
      "[hermes-gateway:event] run=run-123 event=reasoning.available data=not-json",
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "thinking", ts: TS, text: "Hermes reasoning available" });
  });
});

describe("parseHermesGatewayStdoutLine — regression guards for unrelated handlers", () => {
  it("still yields an assistant delta part for message.delta", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("message.delta", { delta: "Hello there" }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "assistant", ts: TS, text: "Hello there", delta: true });
  });

  it("still yields a stdout part for a plain non-event line", () => {
    const result = parseHermesGatewayStdoutLine("just a plain line of output", TS);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "stdout", ts: TS, text: "just a plain line of output" });
  });
});

describe("parseHermesGatewayStdoutLine — tool lifecycle → tool cards (ACP parity)", () => {
  // Shapes captured from real run 97faa15a (Hermi gateway, 2026-11-06):
  // envelope data carries the full frame (event/run_id/timestamp + fields).
  it("maps tool.started to a tool_call with shaped input and the wire tool_call_id", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("tool.started", {
        event: "tool.started",
        run_id: "run_4c54afdd",
        timestamp: 1793966034.36,
        tool: "terminal",
        preview: 'TOKEN=***REDACTED*** -c " import json d=json.load(open(\'/tmp/x.json\'))"',
        tool_call_id: "3ea7425c-a114-4af2-8568-fc0792fe4755",
        seq: 18,
      }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "tool_call",
      ts: TS,
      name: "terminal",
      toolUseId: "3ea7425c-a114-4af2-8568-fc0792fe4755",
      input: { command: 'TOKEN=***REDACTED*** -c " import json d=json.load(open(\'/tmp/x.json\'))"' },
    });
  });

  it("maps tool.completed to a paired tool_result with duration/error", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("tool.completed", {
        event: "tool.completed",
        run_id: "run_4c54afdd",
        timestamp: 1793966034.6,
        tool: "terminal",
        duration: 1.28,
        error: false,
        tool_call_id: "3ea7425c-a114-4af2-8568-fc0792fe4755",
        preview: "amb262-probe-9911",
        seq: 19,
      }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "tool_result",
      ts: TS,
      toolUseId: "3ea7425c-a114-4af2-8568-fc0792fe4755",
      toolName: "terminal",
      content: "amb262-probe-9911",
      isError: false,
    });
  });

  it("falls back to the tool name for pairing when tool_call_id is absent", () => {
    const call = parseHermesGatewayStdoutLine(eventLine("tool.started", { tool: "web_search", preview: "fourier news" }), TS);
    const result = parseHermesGatewayStdoutLine(
      eventLine("tool.completed", { tool: "web_search", duration: 2.5, error: false, preview: "" }),
      TS,
    );
    expect((call[0] as { toolUseId?: string }).toolUseId).toBe("web_search");
    expect(result[0]).toMatchObject({ kind: "tool_result", toolUseId: "web_search", toolName: "web_search" });
  });

  it("renders an errored completion as isError with duration when preview is empty", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("tool.completed", { tool: "terminal", duration: 30, error: true, preview: "" }),
      TS,
    );
    expect(result[0]).toMatchObject({
      kind: "tool_result",
      toolName: "terminal",
      content: "30s",
      isError: true,
    });
  });

  it("shapes non-command tool previews onto recognized summarizer fields", () => {
    const result = parseHermesGatewayStdoutLine(
      eventLine("tool.started", { tool: "web_search", preview: "傅利叶 最新新闻", tool_call_id: "abc" }),
      TS,
    );
    expect(result[0]).toMatchObject({
      kind: "tool_call",
      name: "web_search",
      input: { query: "傅利叶 最新新闻" },
    });
  });

  it("keeps unknown tool lifecycle events as system lines", () => {
    const result = parseHermesGatewayStdoutLine(eventLine("tool.some_new_event", { tool: "x" }), TS);
    expect(result[0]).toEqual({ kind: "system", ts: TS, text: "Hermes event: tool.some_new_event" });
  });
});
