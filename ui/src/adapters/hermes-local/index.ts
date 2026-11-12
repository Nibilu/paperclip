import type { UIAdapterModule } from "../types";
import {
  createHermesStdoutParser,
  parseHermesStdoutLine,
  buildHermesConfig,
} from "@pilibalaai/hermes-pilibala-adapter/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const hermesLocalUIAdapter: UIAdapterModule = {
  type: "hermes_local",
  label: "Hermes",
  // Stateless fallback + stateful modern-layout parser (reasoning blocks →
  // thinking entries, banner bodies → assistant entries).
  parseStdoutLine: parseHermesStdoutLine,
  createStdoutParser: createHermesStdoutParser,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildHermesConfig,
};

