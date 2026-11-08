/** Identify leftover raw-JSON assistant entries under the FIXED hermes parser */
import fs from "node:fs";
import { buildTranscript } from "../ui/src/adapters/transcript.ts";
import { parseHermesStdoutLine } from "../packages/adapters/hermes/src/ui/parse-stdout.ts";

const ACPX = "/home/amber/.pilibala/instances/default/data/run-logs/22bb83e2-4344-4a27-9f32-b853ce198a3e/9d1ec7a5-71ed-45e7-ba80-1ad75483a9f4/836ae6e8-704b-4ed4-bdf6-058d8e3c8b7d.ndjson";
const chunks = fs
  .readFileSync(ACPX, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((r) => r.stream === "stdout" && typeof r.chunk === "string" && r.chunk.trim())
  .map((r) => ({ ts: r.ts, stream: r.stream, chunk: r.chunk }));

const entries = buildTranscript(chunks as any, parseHermesStdoutLine);
const raw = entries.filter((e: any) => e.kind === "assistant" && e.text?.startsWith('{"type"'));
console.log("raw-JSON assistant entries:", raw.length);
for (const e of raw) {
  console.log("  full line:", e.text.slice(0, 300));
}
// Also: which raw stdout lines fail JSON.parse entirely (fallback stdout kind)?
const entriesStdout = entries.filter((e: any) => e.kind === "stdout");
console.log("\nstdout-kind entries:", entriesStdout.length);
for (const e of entriesStdout) console.log("  ", JSON.stringify(e.text.slice(0, 160)));
