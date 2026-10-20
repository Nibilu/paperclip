import { describe, expect, it } from "vitest";
import { parseHermesStdoutLine } from "./parse-stdout.js";

const TS = "2026-06-29T12:00:00.000Z";

describe("parseHermesStdoutLine — ANSI stripping", () => {
  it("strips 24-bit foreground + background color CSI sequences", () => {
    const result = parseHermesStdoutLine(
      "\x1b[38;2;255;255;255;48;2;19;87;20m+r = curl(\"POST\", \"/api/issues/d7b08cc5/comments\",\x1b[0m",
      TS,
    );
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      for (const v of Object.values(entry)) {
        if (typeof v === "string") {
          expect(v).not.toMatch(/\x1b\[/);
        }
      }
    }
  });

  it("strips bold yellow CSI sequence from Hermes header", () => {
    const result = parseHermesStdoutLine("\x1b[1;38;2;255;215;0m- Hermes\x1b[0m", TS);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("text", "- Hermes");
  });

  it("strips light text CSI sequence", () => {
    const result = parseHermesStdoutLine(
      "\x1b[38;2;255;248;220mAll done. Now let me verify.\x1b[0m",
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("text", "All done. Now let me verify.");
  });

  it("passes through clean text unchanged", () => {
    const result = parseHermesStdoutLine("Normal text without ANSI", TS);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("text", "Normal text without ANSI");
  });

  it("strips multiple CSI sequences on a single line", () => {
    const result = parseHermesStdoutLine(
      "\x1b[38;2;255;255;255;48;2;19;87;20m+ \"priority\": \"highest\",\x1b[0m \x1b[38;2;255;255;255;48;2;19;87;20m+r = curl(\"PATCH\", ...\x1b[0m",
      TS,
    );
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      for (const v of Object.values(entry)) {
        if (typeof v === "string") {
          expect(v).not.toMatch(/\x1b\[/);
        }
      }
    }
  });

  it("still parses tool completion lines correctly after stripping", () => {
    const result = parseHermesStdoutLine("\u250a \u{1f50d} search \"pattern\" 0.5s", TS);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const toolCall = result.find((e) => e.kind === "tool_call");
    expect(toolCall?.name).toBe("search");
  });

  it("still parses shell tool lines correctly after stripping", () => {
    const result = parseHermesStdoutLine("\u250a $ ls -la 0.3s", TS);
    const toolCall = result.find((e) => e.kind === "tool_call");
    expect(toolCall?.name).toBe("shell");
  });

  it("strips OSC title sequences", () => {
    const result = parseHermesStdoutLine("\x1b]0;Terminal Title\x07Actual content", TS);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("text", "Actual content");
  });

  it("handles empty lines after ANSI stripping", () => {
    const result = parseHermesStdoutLine("\x1b[0m", TS);
    expect(result).toHaveLength(0);
  });
});

describe("parseHermesStdoutLine — acpx engine JSON events", () => {
  it("maps thought-channel text_delta to a thinking delta entry (not raw JSON)", () => {
    const result = parseHermesStdoutLine(
      JSON.stringify({ type: "acpx.text_delta", text: "Let", channel: "thought", tag: "agent_thought_chunk" }),
      TS,
    );
    expect(result).toEqual([{ kind: "thinking", ts: TS, text: "Let", delta: true }]);
  });

  it("maps output-channel text_delta to an assistant delta entry", () => {
    const result = parseHermesStdoutLine(
      JSON.stringify({ type: "acpx.text_delta", text: "Hello", channel: "output", tag: "agent_message_chunk" }),
      TS,
    );
    expect(result).toEqual([{ kind: "assistant", ts: TS, text: "Hello", delta: true }]);
  });

  it("maps acpx.tool_call to a tool_call entry with tool_result on completion", () => {
    const started = parseHermesStdoutLine(
      JSON.stringify({ type: "acpx.tool_call", name: "terminal", toolCallId: "t1", status: "in_progress" }),
      TS,
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ kind: "tool_call", name: "terminal", toolUseId: "t1" });

    const completed = parseHermesStdoutLine(
      JSON.stringify({ type: "acpx.tool_call", name: "terminal", toolCallId: "t1", status: "completed", text: "done" }),
      TS,
    );
    expect(completed).toHaveLength(2);
    expect(completed[1]).toMatchObject({ kind: "tool_result", toolUseId: "t1", isError: false });
  });

  it("maps acpx.session to an init entry and acpx.result to a result entry", () => {
    const session = parseHermesStdoutLine(
      JSON.stringify({ type: "acpx.session", agent: "hermes", sessionId: "s1" }),
      TS,
    );
    expect(session[0]?.kind).toBe("init");

    const result = parseHermesStdoutLine(
      JSON.stringify({ type: "acpx.result", summary: "done", stopReason: "end_turn" }),
      TS,
    );
    expect(result[0]?.kind).toBe("result");
  });

  it("falls back to the Hermes CLI grammar for non-acpx JSON lines", () => {
    const result = parseHermesStdoutLine(
      JSON.stringify({ event: "message.delta", run_id: "run_x" }),
      TS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "assistant" });
  });

  it("never leaks raw acpx JSON through the assistant fallthrough", () => {
    for (const type of ["acpx.text_delta", "acpx.status", "acpx.session", "acpx.result"]) {
      const line = JSON.stringify({ type, text: "x" });
      const entries = parseHermesStdoutLine(line, TS);
      for (const entry of entries) {
        if ("text" in entry && typeof entry.text === "string") {
          expect(entry.text).not.toContain('"acpx.');
        }
      }
    }
  });
});
