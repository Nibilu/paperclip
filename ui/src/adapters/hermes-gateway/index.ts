import type { UIAdapterModule } from "../types";
import { parseStdoutLine as parseHermesGatewayStdoutLine } from "@pilibalaai/hermes-pilibala-adapter/gateway/ui";
import { buildSchemaAdapterConfig } from "../schema-config-fields";
import { HermesGatewayConfigFields } from "./config-fields";

function buildHermesGatewayConfig(values: Parameters<typeof buildSchemaAdapterConfig>[0]): Record<string, unknown> {
  const config = buildSchemaAdapterConfig(values);
  // The onboarding wizard collects the gateway address through its generic
  // `url` field (the same field openclaw_gateway uses); the full agent
  // configuration form passes it as the schema field `apiBaseUrl`. Map the
  // former only when the latter did not already set it.
  const url = typeof values.url === "string" ? values.url.trim() : "";
  if (url && !config.apiBaseUrl) config.apiBaseUrl = url;
  return config;
}

export const hermesGatewayUIAdapter: UIAdapterModule = {
  type: "hermes_gateway",
  label: "Hermes Gateway",
  parseStdoutLine: parseHermesGatewayStdoutLine,
  ConfigFields: HermesGatewayConfigFields,
  buildAdapterConfig: buildHermesGatewayConfig,
};
