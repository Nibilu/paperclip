/** Probe: what does each parser return for a synthetic acpx line? (no top-level await) */
import { parseHermesStdoutLine } from "../packages/adapters/hermes/src/ui/parse-stdout.ts";
import { parseAcpxStdoutLine } from "../packages/adapter-utils/src/acpx-engine/ui.ts";

const line = JSON.stringify({ type: "acpx.text_delta", text: "继续", channel: "output", tag: "agent_message_chunk" });
console.log("hermes parser on acpx line:", JSON.stringify(parseHermesStdoutLine(line, "t")));
console.log("acpx parser on acpx line:", JSON.stringify(parseAcpxStdoutLine(line, "t")));
