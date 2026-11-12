import { describe, expect, it } from "vitest";
import { createHermesStdoutParser, parseHermesStdoutLine } from "./parse-stdout.js";
import { createCliLiveStreamFilter } from "../server/execute.js";

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

describe("parseHermesStdoutLine — corrupted acpx event lines", () => {
  it("downgrades unparseable acpx events to system notes instead of agent-output kinds", () => {
    const corrupted = '{"type":"acpx.text_delta","text":"H \\"Authorization:\\"REDACTED\\"channel":"thought","tag":"agent_thought_chunk"}';
    const entries = parseHermesStdoutLine(corrupted, "2026-11-05T00:00:00.000Z");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("system");
    expect(String((entries[0] as { text?: string })?.text ?? "")).toContain("[corrupted acpx event]");
    expect(String((entries[0] as { text?: string })?.text ?? "")).toContain("acpx.text_delta");
  });

  it("long corrupted lines are truncated in the preview", () => {
    // Real broken-line shape: the escaped closing quote around a redacted
    // value swallows the field separator, leaving invalid JSON.
    const corrupted = `{"type":"acpx.text_delta","text":"H \\"Authorization: ***","text2":"${"x".repeat(400)}"channel":"thought","tag":"agent_thought_chunk"}`;
    const entries = parseHermesStdoutLine(corrupted, "2026-11-05T00:00:00.000Z");
    expect(entries[0]?.kind).toBe("system");
    expect(String((entries[0] as { text?: string })?.text ?? "").length).toBeLessThan(200);
  });

  it("non-acpx JSON still falls through to the CLI grammar untouched", () => {
    const entries = parseHermesStdoutLine('{"unrelated":"json"}', "2026-11-05T00:00:00.000Z");
    // Whatever the CLI grammar does with it, it must not become a corrupted-acpx system note.
    expect(entries.every((e) => !String((e as { text?: string }).text ?? "").includes("[corrupted acpx event]"))).toBe(true);
  });
});

describe("parseHermesStdoutLine — modern non-quiet tool rows & lifecycle lines (AMB-261)", () => {
  it("classifies the Hindsight memory lifecycle line as system, not assistant", () => {
    const entries = parseHermesStdoutLine("👁️ Hindsight — saving to memory…", TS);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("system");
    expect((entries[0] as { text?: string }).text).toContain("Hindsight");
  });

  it("classifies the compaction lifecycle line as system", () => {
    const entries = parseHermesStdoutLine("✓ Context compaction complete — continuing turn...", TS);
    expect(entries[0]?.kind).toBe("system");
  });

  it("parses `🐍 Exec … 0.2s` as an execute_code tool row, not assistant text", () => {
    const entries = parseHermesStdoutLine("🐍 Exec import os, json, urllib.request  0.2s", TS);
    expect(entries).toHaveLength(2);
    const call = entries[0] as { kind: string; name?: string; input?: { command?: string }; toolUseId?: string };
    const result = entries[1] as { kind: string; toolUseId?: string; content?: string; isError?: boolean };
    expect(call.kind).toBe("tool_call");
    expect(call.name).toBe("execute_code");
    expect(call.input?.command).toContain("import os, json");
    expect(call.toolUseId).toBeTruthy();
    expect(result.kind).toBe("tool_result");
    expect(result.toolUseId).toBe(call.toolUseId);
    expect(result.content).toContain("0.2s");
    expect(result.isError).toBe(false);
  });

  it("shapes tool-row input with UI-recognized field names per tool", () => {
    const cases: Array<[string, string, Record<string, string>]> = [
      ["💻 $ pytest -q  0.4s", "terminal", { command: "pytest -q" }],
      ["📖 Read /tmp/run.env  0.0s", "read_file", { path: "/tmp/run.env" }],
      ["✍ Write /tmp/out.txt  0.1s", "write_file", { path: "/tmp/out.txt" }],
      ["🔎 find *.test.ts  0.3s", "search_files", { pattern: "*.test.ts" }],
      ["🌐 navigate https://example.com  1.2s", "browser", { url: "https://example.com" }],
      ["👆 Click Submit button  0.5s", "browser_click", { text: "Submit button" }],
    ];
    for (const [row, name, input] of cases) {
      const entries = parseHermesStdoutLine(row, TS);
      const call = entries[0] as { kind: string; name?: string; input?: Record<string, string> };
      expect(call.kind, row).toBe("tool_call");
      expect(call.name, row).toBe(name);
      expect(call.input, row).toEqual(input);
    }
  });

  it("parses `💻 $ … 1.3s` as a terminal tool row", () => {
    const entries = parseHermesStdoutLine("💻 $ envf=/tmp/run.env pid=2893054 + 5 commands…  1.3s", TS);
    const call = entries[0] as { kind: string; name?: string };
    expect(call.kind).toBe("tool_call");
    expect(call.name).toBe("terminal");
  });

  it("parses `✗ $ … [exit 1]` as a failed terminal tool row", () => {
    const entries = parseHermesStdoutLine("✗ $ cat <<'EOF' import subprocess, hmac  0.4s [exit 1]", TS);
    const call = entries[0] as { kind: string; name?: string };
    const result = entries[1] as { kind: string; isError?: boolean };
    expect(call.kind).toBe("tool_call");
    expect(call.name).toBe("terminal");
    expect(result.kind).toBe("tool_result");
    expect(result.isError).toBe(true);
  });

  it("parses `✗ Memory ? […]` as a failed memory tool row", () => {
    const entries = parseHermesStdoutLine("✗ Memory ? [Applying all 1 operations would put memory at its cap]", TS);
    const call = entries[0] as { kind: string; name?: string };
    const result = entries[1] as { kind: string; isError?: boolean };
    expect(call.kind).toBe("tool_call");
    expect(call.name).toBe("memory");
    expect(result.isError).toBe(true);
  });

  it("keeps genuine assistant text in the assistant lane (negative guards)", () => {
    // ✗ + unknown verb: model line starting with a failure glyph.
    expect(parseHermesStdoutLine("✗ This approach failed because the build broke", TS)[0]?.kind).toBe("assistant");
    // Emoji + unknown verb, no duration: model text.
    expect(parseHermesStdoutLine("✅ All checks passed, including the tricky ones", TS)[0]?.kind).toBe("assistant");
    // Plain model text ending in a number+unit: still assistant.
    expect(parseHermesStdoutLine("回复已送达，耗时约 2s。", TS)[0]?.kind).toBe("assistant");
    // "Hm-Cli is here." — model greeting, not a tool row.
    expect(parseHermesStdoutLine("Hm-Cli is here.", TS)[0]?.kind).toBe("assistant");
  });
});

describe("createHermesStdoutParser (stateful modern-layout structures)", () => {
  const SEP = "─".repeat(40);
  const parser = () => createHermesStdoutParser();
  const kinds = (entries: { kind: string }[]) => entries.map((e) => e.kind);
  const texts = (entries: { text?: string }[]) => entries.map((e) => e.text).join("");

  it("classifies reasoning-block text as thinking entries (matches ACP thought channel)", () => {
    const p = parser();
    const lines = [
      "Query: 检查 run 1234 的日志",
      SEP, // reasoning box opening (right after the echo)
      "先定位 run id，再读日志字段。",
      "session id 可能为 local-<sha256> 格式。",
      "∴ Thought for 3s · 定位日志",
      SEP, // reasoning box closing
    ];
    const entries = lines.flatMap((l) => p.parseLine(l, TS));
    const thinking = entries.filter((e) => e.kind === "thinking") as { text?: string }[];
    expect(thinking).toHaveLength(2);
    expect(texts(thinking)).toContain("先定位 run id，再读日志字段。");
    // The ∴ summary and separators are chrome — no assistant entries at all.
    expect(kinds(entries).filter((k) => k === "assistant")).toHaveLength(0);
  });

  it("classifies answer-banner body as assistant entries", () => {
    const p = parser();
    const entries = [
      SEP,
      "☤ Hermes",
      "run 1234 的 session id 是 local-abc123。",
      SEP,
    ].flatMap((l) => p.parseLine(l, TS));
    const assistant = entries.filter((e) => e.kind === "assistant") as { text?: string }[];
    expect(assistant).toHaveLength(1);
    expect(texts(assistant)).toBe("run 1234 的 session id 是 local-abc123。");
    // ☤ title line and separators are consumed.
    expect(entries).toHaveLength(1);
  });

  it("handles a full turn: reasoning → tool row → answer banner", () => {
    const p = parser();
    const entries = [
      "Query: run echo probe",
      SEP,
      "需要执行 echo 命令并报告输出。",
      "∴ Thought for 1s · 执行命令",
      SEP,
      "💻 $ echo probe-88  0.2s",
      SEP,
      "☤ Hermes",
      "probe-88",
      SEP,
      "👁️ Hindsight — saving to memory…",
    ].flatMap((l) => p.parseLine(l, TS));
    expect(kinds(entries)).toEqual(["thinking", "tool_call", "tool_result", "assistant", "system"]);
  });

  it("returns to idle after each block so legacy/system lines still classify", () => {
    const p = parser();
    p.parseLine(SEP, TS);
    p.parseLine("☤ Hermes", TS);
    p.parseLine("answer", TS);
    p.parseLine(SEP, TS);
    expect(kinds(p.parseLine("👁️ Hindsight — saving to memory…", TS))).toEqual(["system"]);
    expect(kinds(p.parseLine("[hermes] Reconciled session local-abc (--resume local-abc)", TS))).toEqual(["system"]);
    expect(kinds(p.parseLine("💻 $ ls /tmp  0.1s", TS))).toEqual(["tool_call", "tool_result"]);
  });

  it("reset() returns to idle", () => {
    const p = parser();
    p.parseLine(SEP, TS);
    p.parseLine("reasoning text", TS);
    expect(p.parseLine("whatever", TS)[0]?.kind).toBe("thinking");
    p.reset();
    expect(p.parseLine("whatever", TS)[0]?.kind).toBe("assistant");
  });

  it("accepted edge: a text line containing dashes right after a separator opens reasoning", () => {
    const p = parser();
    expect(p.parseLine(SEP, TS)).toHaveLength(0); // → pending
    // Not ^────$ (has text): treated as the reasoning opening.
    expect(kinds(p.parseLine(`${SEP} model hr ${SEP}`, TS))).toEqual(["thinking"]);
    // A real ──── inside the block closes it; next line falls back to the
    // stateless pipeline.
    expect(p.parseLine(SEP, TS)).toHaveLength(0);
    expect(kinds(p.parseLine("普通回复文本", TS))).toEqual(["assistant"]);
  });
});

describe("filter → stateful parser end-to-end (real CLI shape, AMB-254 UI parity)", () => {
  // Captured verbatim from `hermes chat -q "Use the terminal tool to run
  // exactly: echo amb262-probe-9911, then report the output in one line."`
  // (display.platforms.cli.show_reasoning=true, 2026-11-12). ANSI stripped.
  const REAL_STDOUT = [
    "Query: Use the terminal tool to run exactly: echo amb262-probe-9911, then report",
    "the output in one line.",
    "",
    "────────────────────────────────────────",
    "The user asks me to run exactly `echo amb262-probe-9911` via the terminal tool and",
    " report the output in one line. This is a simple task. Let me run it.",
    "∴ Thought for 1s · The user asks me to run exactly `echo amb262-probe-9911` via the termin…",
    "────────────────────────────────────────",
    "",
    "💻 $ echo amb262-probe-9911  0.5s",
    "",
    "────────────────────────────────────────",
    "☤ Hermes",
    "amb262-probe-9911",
    "────────────────────────────────────────",
    "👁️ Hindsight — saving to memory…",
    "",
    "Resume this session with:",
    "  hermes --resume local-1dd088bc7065b72b507dc0e2e134736865eadd096044ab4dfa2d298bab0f71b4",
    "",
    "Session:        local-1dd088bc7065b72b507dc0e2e134736865eadd096044ab4dfa2d298bab0f71b4",
    "Duration:       1m 31s",
    "Messages:       4 (1 user, 2 tool calls)",
  ].join("\n");

  function runThroughFilterThenParser() {
    const filter = createCliLiveStreamFilter();
    let filtered = "";
    for (const chunk of REAL_STDOUT.split("\n").map((l) => `${l}\n`)) {
      const out = filter(chunk);
      if (out) filtered += out;
    }
    const parser = createHermesStdoutParser();
    return filtered
      .split("\n")
      .flatMap((l) => parser.parseLine(l, TS))
      .filter((e) => e.kind !== "init");
  }

  it("yields the same entry shapes as the ACP lane: thinking blocks, tool cards, one answer", () => {
    const entries = runThroughFilterThenParser();
    const kinds_ = entries.map((e) => e.kind);
    // No assistant pollution from the reasoning text or the echo.
    expect(kinds_.filter((k) => k === "assistant")).toHaveLength(1);
    const thinking = entries.filter((e) => e.kind === "thinking") as { text?: string }[];
    expect(thinking.map((e) => e.text).join(" ")).toContain("The user asks me to run exactly");
    // ∴ summary and separators never surface.
    expect(thinking.map((e) => e.text).join(" ")).not.toContain("Thought for");
    const call = entries.find((e) => e.kind === "tool_call") as { name?: string; input?: { command?: string } };
    expect(call.name).toBe("terminal");
    expect(call.input?.command).toBe("echo amb262-probe-9911");
    const answer = entries.find((e) => e.kind === "assistant") as { text?: string };
    expect(answer.text).toBe("amb262-probe-9911");
    expect(kinds_).toContain("system"); // Hindsight lifecycle line
  });
});
