import { describe, expect, it } from "vitest";
// parseHermesOutput is exported for testing (module-local by history).
import { parseHermesOutput } from "./execute.js";

/**
 * Real stdout shape from dev run f64c5197 (issue 28b0190c, 2026-11-03): the
 * current hermes classic CLI display prints the composed prompt under
 * "Query:" first, tool activity lines, then the answer wrapped in ──── /
 * ☤ Hermes / ──── banner separators, footer noise, and a resume hint.
 */
const MODERN_DISPLAY_STDOUT = [
  "[hermes] Reconciled 3 Pilibala-managed skill(s) into the Hermes skills home.\n",
  "[hermes] Starting Hermes Agent (model=auto, provider=auto [auto], timeout=1800s)\n",
  'Query: You are "HM-Cli", an AI agent employee in a Pilibala-managed company.\n\nPilibala runtime identity:\n- Agent ID: agent-1\n\n## Pilibala Wake Payload\n...24KB of composed prompt...\n',
  "🐍 Exec import os, json, subprocess\r\n",
  "💻 $ printf 'api=%s key_set=%s\\n' \"$PILIBALA_API_URL\"\n",
  "────────────────────────────────────────\r\n☤ Hermes\r\n",
  "今天是 2026 年 11 月 3 日，星期二。\r\n",
  "────────────────────────────────────────\r\n",
  "⚠️ Model fallback: auto via nvidia unavailable (provider failure); using gpt-5.6-luna via openai-codex.\r\n",
  "👁️ Hindsight — saving to memory…\r\n",
  "\n",
  "Resume this session with:\n",
  "  hermes --resume local-863e321b60c9ceaeb2462c0dd48087092c6eaaf296e437bb849fb5aa71f1a7c4\n",
  "[hermes] Exit code: 0, timed out: false\n",
].join("");

describe("parseHermesOutput — modern classic-CLI display (c80f0e6c)", () => {
  it("extracts the banner-delimited answer, never the prompt echo", () => {
    const parsed = parseHermesOutput(MODERN_DISPLAY_STDOUT, "");
    expect(parsed.response).toBe("今天是 2026 年 11 月 3 日，星期二。");
    expect(parsed.response).not.toContain("Query:");
    expect(parsed.response).not.toContain("Pilibala runtime identity");
  });

  it("captures the session id from the resume hint", () => {
    const parsed = parseHermesOutput(MODERN_DISPLAY_STDOUT, "");
    expect(parsed.sessionId).toBe(
      "local-863e321b60c9ceaeb2462c0dd48087092c6eaaf296e437bb849fb5aa71f1a7c4",
    );
  });

  it("keeps a multi-line banner answer intact", () => {
    const stdout = MODERN_DISPLAY_STDOUT.replace(
      "今天是 2026 年 11 月 3 日，星期二。",
      "第一行结论。\n\n第二行补充说明。\n- 要点 A\n- 要点 B",
    );
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe(
      "第一行结论。\n\n第二行补充说明。\n- 要点 A\n- 要点 B",
    );
  });

  it("falls back to the last banner block when several runs appear", () => {
    const stdout = `${MODERN_DISPLAY_STDOUT}\nadditional banner block:\n────────\r\n☤ Hermes\r\n最终回复。\r\n────────\r\n`;
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("最终回复。");
  });

  it("does not mistake a footer line for the answer when the banner is absent (echo guard)", () => {
    // Unknown future format: no banner, and the cleaned output is dominated by
    // the prompt echo. The echo is never a reply — fail safe with no response.
    const stdout = [
      'Query: You are "HM-Cli", an AI agent employee in a Pilibala-managed company.\n',
      "Pilibala runtime identity:\n- Agent ID: agent-1\n",
      "## Fresh session handoff\nbounded background...\n",
      "session saved: local-abc123\n",
    ].join("");
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBeUndefined();
    expect(parsed.sessionId).toBe("local-abc123");
  });

  it("still answers in quiet mode (session_id line) — unchanged", () => {
    const stdout = "这是安静模式的答案。\n\nsession_id: local-quiet-1\n";
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("这是安静模式的答案。");
    expect(parsed.sessionId).toBe("local-quiet-1");
  });

  it("still cleans legacy tool noise without a banner or echo — unchanged", () => {
    const stdout = "[tool] running tool\n真正的回复内容。\n[hermes] noise\n";
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("真正的回复内容。");
  });
});

describe("parseHermesOutput — current non-quiet output (AMB-266 / C4)", () => {
  /** Real line shapes from dev runs d6cb2e51 / f64c5197 (HM-Cli, non-quiet). */
  const CURRENT_NO_BANNER_STDOUT = [
    "[hermes] Reconciled 3 Pilibala-managed skill(s) into the Hermes skills home.\n",
    "[hermes] Starting Hermes Agent (model=z-ai/glm-5.3-flash, provider=auto [auto], timeout=10800s)\n",
    'Query: You are "HM-Cli", an AI agent employee in a Pilibala-managed company.\nPilibala runtime identity:\n- Agent ID: agent-1\n...24KB of composed prompt...\n',
    "今天是周四（2026年11月12日，北京时间）。已回复到 AMB-143 会话中。\n",
    "👁️ Hindsight — saving to memory…\n",
    "\n",
    "Resume this session with:\n",
    "  hermes --resume local-4a526286d3d2cabcbee484a8e4bb0d57f679d06c7e0c01b0cc375a5c63b28d01\n",
    "[hermes] Exit code: 0, timed out: false\n",
  ].join("");

  it("no-banner stdout with a Query echo and no structural separator: echo guard returns no response", () => {
    // The reply cannot be told apart from the echo body line-by-line, so the
    // documented fail-safe applies: no response (raw stdout stays in the log).
    const parsed = parseHermesOutput(CURRENT_NO_BANNER_STDOUT, "");
    expect(parsed.response).toBeUndefined();
    expect(parsed.sessionId).toBe(
      "local-4a526286d3d2cabcbee484a8e4bb0d57f679d06c7e0c01b0cc375a5c63b28d01",
    );
  });

  it("no-banner stdout without a Query echo (resumed runs): reply extracts cleanly", () => {
    // Real shape of dev run d6cb2e51 (HM-Cli, non-quiet, resumed): no echo,
    // reply directly followed by lifecycle + exit-summary lines.
    const stdout = [
      "[hermes] Reconciled 3 Pilibala-managed skill(s) into the Hermes skills home.\n",
      "[hermes] Starting Hermes Agent (model=z-ai/glm-5.3-flash, provider=auto [auto], timeout=10800s)\n",
      "今天是周四（2026年11月12日，北京时间）。已回复到 AMB-143 会话中。\n",
      "👁️ Hindsight — saving to memory…\n",
      "\n",
      "Resume this session with:\n",
      "  hermes --resume local-4a526286d3d2cabcbee484a8e4bb0d57f679d06c7e0c01b0cc375a5c63b28d01\n",
      "[hermes] Exit code: 0, timed out: false\n",
    ].join("");
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("今天是周四（2026年11月12日，北京时间）。已回复到 AMB-143 会话中。");
    expect(parsed.response).not.toContain("Hindsight");
    expect(parsed.sessionId).toBe(
      "local-4a526286d3d2cabcbee484a8e4bb0d57f679d06c7e0c01b0cc375a5c63b28d01",
    );
  });

  it("no-banner stdout where a tool row separates the echo from the reply: reply is recovered", () => {
    // The tool row ends the echo-suppression window (same structural signal
    // as the live log filter), so the reply after it survives.
    const stdout = [
      'Query: You are "HM-Cli".\nPilibala runtime identity:\n- Agent ID: agent-1\n',
      "💻 $ grep -rn quiet src/  0.2s\n",
      "grep 命中 3 处，quiet 默认是 true。\n",
      "👁️ Hindsight — saving to memory…\n",
      "Session: local-abc123\n",
    ].join("");
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("grep 命中 3 处，quiet 默认是 true。");
    expect(parsed.sessionId).toBe("local-abc123");
  });

  it("captures the session id from the indented resume hint", () => {
    const parsed = parseHermesOutput(CURRENT_NO_BANNER_STDOUT, "");
    expect(parsed.sessionId).toBe(
      "local-4a526286d3d2cabcbee484a8e4bb0d57f679d06c7e0c01b0cc375a5c63b28d01",
    );
  });

  it("captures the session id from the `Session: <id>` exit summary line (no resume hint)", () => {
    const stdout = "回复完成。\nSession: local-82ff33a4374bc7135905a105ec623123110f7187d03584cdcac60dc9d5973ab9\n";
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("回复完成。");
    expect(parsed.sessionId).toBe("local-82ff33a4374bc7135905a105ec623123110f7187d03584cdcac60dc9d5973ab9");
  });

  it("drops modern tool rows and lifecycle lines from the fallback reply", () => {
    const stdout = [
      "先看日志。",
      "🐍 Exec import os, json, urllib.request  0.2s",
      "查到了，结论如下：一切正常。",
      "👁️ Hindsight — saving to memory…",
      "Session: local-abc123",
    ].join("\n") + "\n";
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("先看日志。\n查到了，结论如下：一切正常。");
    expect(parsed.sessionId).toBe("local-abc123");
  });

  it("keeps genuine model text that only looks like noise (negative guard)", () => {
    const stdout = "✗ This approach failed because the build broke.\nSession: local-keep1\n";
    const parsed = parseHermesOutput(stdout, "");
    expect(parsed.response).toBe("✗ This approach failed because the build broke.");
    expect(parsed.sessionId).toBe("local-keep1");
  });

  it("banner-delimited answers still win over the fallback path (AMB-160 regression)", () => {
    const parsed = parseHermesOutput(MODERN_DISPLAY_STDOUT, "");
    expect(parsed.response).toBe("今天是 2026 年 11 月 3 日，星期二。");
    expect(parsed.response).not.toContain("Query:");
    expect(parsed.sessionId).toBe("local-863e321b60c9ceaeb2462c0dd48087092c6eaaf296e437bb849fb5aa71f1a7c4");
  });
});
