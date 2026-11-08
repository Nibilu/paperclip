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
