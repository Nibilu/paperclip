/** Show glued stdout blobs from BEFORE-fix gateway replay — proves the fragment mechanism */
import fs from "node:fs";
import { buildTranscript } from "../ui/src/adapters/transcript.ts";
import { parseHermesGatewayStdoutLine } from "../packages/adapters/hermes/src/gateway/ui/parse-stdout.ts";

const GW = "/home/amber/.pilibala/instances/default/data/run-logs/22bb83e2-4344-4a27-9f32-b853ce198a3e/19e9c7ad-963e-4ef1-99e1-8376f69440db/267089d0-a230-478f-93f1-25ed4cf945e4.ndjson";
const chunks = fs
  .readFileSync(GW, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((r) => r.stream === "stdout" && typeof r.chunk === "string" && r.chunk.trim())
  .map((r) => ({ ts: r.ts, stream: r.stream, chunk: r.chunk }));

const entries = buildTranscript(chunks as any, parseHermesGatewayStdoutLine);
const std = entries.filter((e: any) => e.kind === "stdout");
console.log("stdout entries:", std.length);
const gluedWithEnvelope = std.filter((e: any) => e.text.includes("hermes-gateway:event"));
console.log("stdout blobs containing a glued event envelope:", gluedWithEnvelope.length);
console.log("\n— sample glued blob (start of a delta glued in front of an envelope):");
const sample = gluedWithEnvelope.find((e: any) => !e.text.startsWith("[hermes-gateway"));
console.log(JSON.stringify(sample?.text.slice(0, 400)));
console.log("\n— assistant entries (the only text that rendered as chat bubbles):");
for (const e of entries.filter((x: any) => x.kind === "assistant")) console.log(JSON.stringify(e.text));
