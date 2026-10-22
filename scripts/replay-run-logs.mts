/**
 * Replay real run logs through the REAL UI parsing pipeline to verify both diagnoses.
 * Run: npx tsx scripts/replay-run-logs.mts (from /home/amber/paperclip)
 */
import fs from "node:fs";

// Real repo code, no mocks
const { buildTranscript } = await import("../ui/src/adapters/transcript.ts");
const { parseHermesGatewayStdoutLine } = await import(
  "../packages/adapters/hermes/src/gateway/ui/parse-stdout.ts"
);
const { parseHermesStdoutLine } = await import("../packages/adapters/hermes/src/ui/parse-stdout.ts");
const { parseAcpxStdoutLine } = await import("../packages/adapter-utils/src/acpx-engine/ui.ts");

function loadChunks(path: string) {
  return fs
    .readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((r) => typeof r.chunk === "string" && r.chunk.trim())
    .map((r) => ({ ts: r.ts, stream: r.stream, chunk: r.chunk, seq: r.seq }));
}

function dist(entries: any[]) {
  const d: Record<string, number> = {};
  for (const e of entries) d[e.kind] = (d[e.kind] ?? 0) + 1;
  return d;
}

const GW = "/home/amber/.paperclip/instances/default/data/run-logs/22bb83e2-4344-4a27-9f32-b853ce198a3e/19e9c7ad-963e-4ef1-99e1-8376f69440db/267089d0-a230-478f-93f1-25ed4cf945e4.ndjson";
const ACPX = "/home/amber/.paperclip/instances/default/data/run-logs/22bb83e2-4344-4a27-9f32-b853ce198a3e/9d1ec7a5-71ed-45e7-ba80-1ad75483a9f4/836ae6e8-704b-4ed4-bdf6-058d8e3c8b7d.ndjson";

console.log("========== PROBLEM 2: hermes_gateway run 267089d0 (BG task, AMB-71) ==========");

// BEFORE: all chunks as recorded, current parser
const gw = loadChunks(GW).filter((c) => c.stream === "stdout");
const before = buildTranscript(gw as any, parseHermesGatewayStdoutLine);
console.log("[BEFORE fix] entry kinds:", dist(before));
const assistantBefore = before.filter((e) => e.kind === "assistant");
console.log("[BEFORE fix] assistant entries:", assistantBefore.length, "texts:", JSON.stringify(assistantBefore.map((e) => e.text)));
const glued = before.filter((e) => e.kind === "stdout");
console.log("[BEFORE fix] stdout entries:", glued.length, "first:", JSON.stringify(glued[0]?.text?.slice(0, 110)));

// AFTER fix simulation: server no longer writes bare deltas => drop bare non-newline chunks
const afterChunks = gw.filter((c) => c.chunk.startsWith("[hermes-gateway") || c.chunk.endsWith("\n"));
const after = buildTranscript(afterChunks as any, parseHermesGatewayStdoutLine);
console.log("[AFTER fix] entry kinds:", dist(after));
const assistantAfter = after.filter((e) => e.kind === "assistant");
const mergedText = assistantAfter.map((e) => e.text).join("");
console.log("[AFTER fix] assistant entries:", assistantAfter.length, "(delta-merged)");
console.log("[AFTER fix] merged assistant text:", JSON.stringify(mergedText.slice(0, 200), null, 0));

console.log("\n========== PROBLEM 1: hermes_local engine=acp run 836ae6e8 (AMB-70) ==========");
const ax = loadChunks(ACPX).filter((c) => c.stream === "stdout");

// BEFORE: current hermes_local parser (no acpx dispatch)
const axBefore = buildTranscript(ax as any, parseHermesStdoutLine);
console.log("[BEFORE fix] entry kinds:", dist(axBefore));
const rawJson = axBefore.filter((e) => e.kind === "assistant" && e.text?.startsWith('{"type"'));
console.log("[BEFORE fix] assistant entries that are raw JSON events:", rawJson.length);
console.log("[BEFORE fix] sample:", JSON.stringify(rawJson[0]?.text?.slice(0, 90)));

// AFTER fix simulation: same parser behavior as the patch will add (acpx.* dispatch)
const fixedParser = (line: string, ts: string) => {
  try {
    const p = JSON.parse(line);
    if (p && typeof p === "object" && !Array.isArray(p) && typeof p.type === "string" && p.type.startsWith("acpx.")) {
      return parseAcpxStdoutLine(line, ts);
    }
  } catch {
    /* not JSON */
  }
  return parseHermesStdoutLine(line, ts);
};
const axAfter = buildTranscript(ax as any, fixedParser);
console.log("[AFTER fix] entry kinds:", dist(axAfter));
const thinking = axAfter.filter((e) => e.kind === "thinking");
const say = axAfter.filter((e) => e.kind === "assistant");
const tools = axAfter.filter((e) => e.kind === "tool_call");
console.log("[AFTER fix] thinking entries:", thinking.length, "| assistant entries:", say.length, "| tool cards:", tools.length);
const thoughtText = thinking.map((e) => e.text).join("");
const sayText = say.map((e) => e.text).join("");
console.log("[AFTER fix] thinking text head:", JSON.stringify(thoughtText.slice(0, 100)));
console.log("[AFTER fix] assistant(output) text head:", JSON.stringify(sayText.slice(0, 100)));
console.log("[AFTER fix] any raw-JSON assistant left?:", axAfter.filter((e) => e.kind === "assistant" && e.text?.startsWith('{"type"')).length);
