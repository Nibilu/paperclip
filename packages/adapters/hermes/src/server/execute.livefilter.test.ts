import { describe, expect, it } from "vitest";
import { createCliLiveStreamFilter } from "./execute.js";

// Live evidence (issue 89ea5cce, AMB-160): the chat thread streamed the whole
// composed-prompt echo ("Query: You are \"HM-Cli\" ... Pilibala runtime
// identity: Agent ID ... Company ID ...") as an agent message while the run
// was executing, because parseHermesStdoutLine's fallback classifies every
// unrecognized stdout line as assistant text. The final reply was correct
// (extraction fix), but the live feed must not carry runner-injected echo at
// all. The filter runs in the adapter's onLog wrapper: run-log parsing and
// session capture keep their own complete stdout copy.

const CLASSIC_RUN_STDOUT = [
  "[hermes] Reconciled 6 Pilibala-managed skill(s) into the Hermes skills home.",
  "[hermes] Starting Hermes Agent (model=z-ai/glm-5.3-flash, provider=nvidia [explicit], timeout=1800s)",
  'Query: You are "HM-Cli", an AI agent employee in a Pilibala-managed company.',
  "Pilibala runtime identity:",
  "Agent ID: 19e9c7ad-963e-4ef1-99e1-8376f69440db",
  "Company ID: 22bb83e2-4344-4a27-9f32-b853ce198a3e",
  "",
  "## Task",
  "今天是星期几？请直接回答。",
  "  ┊ 💻 $         date  0.1s",
  "────────────────────────────────────────",
  "☤ Hermes",
  "今天是 2026 年 11 月 4 日，星期三。",
  "────────────────────────────────────────",
  "Reconciled session local-0609d045 (hermes --resume local-0609d045)",
].join("\n");

const CHUNKINGS = ["whole", "lines", "7byte"] as const;

function chunkedBy(mode: (typeof CHUNKINGS)[number], text: string): string[] {
  if (mode === "whole") return [text];
  if (mode === "lines") return text.split("\n").map((line) => `${line}\n`);
  return Array.from(
    { length: Math.ceil(text.length / 7) },
    (_, i) => text.slice(i * 7, i * 7 + 7),
  );
}

function forwardAll(mode: (typeof CHUNKINGS)[number], text: string) {
  const filter = createCliLiveStreamFilter();
  let acc = "";
  for (const chunk of chunkedBy(mode, text)) {
    const out = filter(chunk);
    if (out) acc += out;
  }
  return acc;
}

describe.each(CHUNKINGS)("createCliLiveStreamFilter [%s chunking]", (mode) => {
  it("drops the prompt echo and banner chrome", () => {
    const out = forwardAll(mode, CLASSIC_RUN_STDOUT);
    expect(out).not.toContain("Query: You are");
    expect(out).not.toContain("Pilibala runtime identity");
    expect(out).not.toContain("Agent ID: 19e9c7ad");
    expect(out).not.toContain("Company ID: 22bb83e2");
    expect(out).not.toContain("## Task");
    expect(out).not.toContain("今天是星期几");
    expect(out).not.toContain("Reconciled session local-0609d045");
  });

  it("keeps the real answer, tool activity, adapter banners, and parser structure", () => {
    const out = forwardAll(mode, CLASSIC_RUN_STDOUT);
    expect(out).toContain("今天是 2026 年 11 月 4 日，星期三。");
    expect(out).toContain("┊ 💻 $");
    expect(out).toContain("[hermes] Reconciled 6 Pilibala-managed skill(s)");
    expect(out).toContain("[hermes] Starting Hermes Agent");
    // ──── separators and the ☤ title are STRUCTURE for the stateful UI
    // parser (createHermesStdoutParser): reasoning-box / banner boundaries.
    expect(out).toContain("────────────────────────");
    expect(out).toContain("☤ Hermes");
  });

  it("emits the banner open/close separators for the parser", () => {
    const out = forwardAll(mode, CLASSIC_RUN_STDOUT);
    const separators = out.split("\n").filter((l) => /^─{8,}$/.test(l.trim()));
    // In this fixture the echo ends at the ┊ tool row, so only the banner's
    // opening and closing separators are emitted.
    expect(separators).toHaveLength(2);
  });
});

describe("createCliLiveStreamFilter reasoning-block structure (AMB-254 UI parity)", () => {
  it("emits the echo-end separator when a reasoning box directly follows the echo", () => {
    const filter = createCliLiveStreamFilter();
    const raw = [
      'Query: You are "HM-Cli", an AI agent employee.',
      "Pilibala runtime identity: Agent ID 19e9c7ad",
      "────────────────────────────────────────",
      "先定位 run id，再读日志字段。",
      "∴ Thought for 3s · 定位日志",
      "────────────────────────────────────────",
      "💻 $ echo probe  0.2s",
    ].join("\n");
    let acc = "";
    for (const chunk of raw.split("\n").map((l) => `${l}\n`)) {
      const out = filter(chunk);
      if (out) acc += out;
    }
    const lines = acc.split("\n").filter(Boolean);
    // Line 1: the separator that ends echo suppression — the stateful parser
    // uses it to open the reasoning block, so it must survive.
    expect(lines[0]).toMatch(/^─{8,}$/);
    expect(acc).toContain("先定位 run id，再读日志字段。");
    expect(acc).toContain("💻 $ echo probe  0.2s");
    expect(acc).not.toContain("Query:");
    expect(acc).not.toContain("Pilibala runtime identity");
  });
});

describe("createCliLiveStreamFilter edge cases", () => {
  it("returns null when a chunk carried only suppressed content", () => {
    const filter = createCliLiveStreamFilter();
    expect(filter('Query: You are "HM-Cli"\nAgent ID: x\nCompany ID: y\n')).toBeNull();
  });

  it("passes quiet-mode output through untouched", () => {
    const filter = createCliLiveStreamFilter();
    const out = filter("Hello!\nsession_id: local-abc\n");
    expect(out).toContain("Hello!");
    expect(out).toContain("session_id: local-abc");
  });

  it("stops suppressing at a structured line and resumes forwarding", () => {
    const filter = createCliLiveStreamFilter();
    expect(filter('Query: You are "HM-Cli"\nsentinel-prompt-body\n')).toBeNull();
    expect(filter("  ┊ 💻 $         date  0.1s\nreal answer text\n")).toContain(
      "real answer text",
    );
  });

  it("does not let echo text leak when the terminator arrives in a later chunk", () => {
    const filter = createCliLiveStreamFilter();
    expect(filter('Query: You are "HM-Cli"\necho line one\necho line two')).toBeNull();
    // The unterminated trailing line was buffered, not dropped: a later chunk
    // completing it as echo body stays suppressed.
    expect(filter(" still echo\n")).toBeNull();
    // And a later structural line ends suppression normally.
    expect(filter("[hermes] Starting Hermes Agent\n")).toContain("[hermes]");
  });

  it("drops the newer session-summary footer block line by line", () => {
    const filter = createCliLiveStreamFilter();
    const out = filter(
      [
        "今天是 2026 年 11 月 4 日，星期三。",
        "Resume this session with:",
        "  hermes --resume local-2601d1ce",
        '  hermes -c "Acknowledge AMB-143 comment"',
        "",
        "Session:        local-2601d1ce",
        "Title:          Acknowledge AMB-143 comment",
        "Duration:       51s",
        "Messages:       4 (1 user, 2 tool calls)",
        "Total cost:     $0.0042",
        "Total tokens:   12,345",
      ].join("\n") + "\n",
    );
    expect(out).toContain("今天是 2026 年 11 月 4 日，星期三。");
    expect(out).not.toContain("hermes --resume");
    expect(out).not.toContain("Session:");
    expect(out).not.toContain("Title:");
    expect(out).not.toContain("Duration:");
    expect(out).not.toContain("Messages:");
    expect(out).not.toContain("Total cost");
    expect(out).not.toContain("Total tokens");
  });
});
