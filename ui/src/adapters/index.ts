export {
  getUIAdapter,
  listUIAdapters,
  findUIAdapter,
  registerUIAdapter,
  unregisterUIAdapter,
  syncExternalAdapters,
  onAdapterChange,
} from "./registry";
export { buildTranscript, createTranscriptBuilder, quietTranscriptFromAdapterConfig, type TranscriptBuilder } from "./transcript";
export type {
  TranscriptEntry,
  StdoutLineParser,
  UIAdapterModule,
  AdapterConfigFieldsProps,
} from "./types";
export type { RunLogChunk } from "./transcript";
