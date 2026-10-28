import { models as anthropic } from "@pilibalaai/adapter-claude-local";
import { models as openai } from "@pilibalaai/adapter-codex-local";
import { models as google } from "@pilibalaai/adapter-gemini-local";
import { models as xai } from "@pilibalaai/adapter-grok-local";
import type { AiConnectionMetadata } from "@pilibalaai/shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return { anthropic, openai, google, xai, openrouter: [] }[connection.provider];
}
