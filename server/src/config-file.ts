import fs from "node:fs";
import {
  DEPLOYMENT_MODES,
  findPilibalaConfigKeyWarnings,
  pilibalaConfigSchema,
  type PilibalaConfig,
  type DeploymentMode,
} from "@pilibalaai/shared";
import { ZodError } from "zod";
import { resolvePilibalaConfigPath } from "./paths.js";
import { isCloudManagedInstance } from "./services/cloud-instance.js";
import { getCloudRuntimeConfigSnapshot, toPilibalaConfig } from "./services/cloud-runtime-config-snapshot.js";

function formatConfigValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

interface ConfigFileWithProvenance {
  config: PilibalaConfig;
  explicitStorageS3Bucket: boolean;
}

export function readConfigFile(options: { includeProvenance: true }): ConfigFileWithProvenance | null;
export function readConfigFile(): PilibalaConfig | null;
export function readConfigFile(options?: { includeProvenance: true }): PilibalaConfig | ConfigFileWithProvenance | null {
  if (isCloudManagedInstance()) {
    const saved = getCloudRuntimeConfigSnapshot().config;
    const config = toPilibalaConfig(saved);
    // A stored snapshot is canonical configuration, including its bucket.
    // It must not inherit local-file provenance or inspect an old home.
    return config && options?.includeProvenance ? { config, explicitStorageS3Bucket: true } : config;
  }

  const configPath = resolvePilibalaConfigPath();

  if (!fs.existsSync(configPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Pilibala config at ${configPath}: failed to read or parse JSON: ${reason}`);
  }

  try {
    const config = pilibalaConfigSchema.parse(raw);
    for (const warning of findPilibalaConfigKeyWarnings(config)) {
      console.warn(
        `Unknown config key ${warning.path}; did you mean ${warning.suggestion}? It will be preserved.`,
      );
    }
    if (options?.includeProvenance) {
      // Schema validation above establishes the input shape, but fills omitted
      // buckets with a default. Keep only that provenance at the file boundary.
      const input = raw as Partial<PilibalaConfig>;
      return { config, explicitStorageS3Bucket: input.storage?.s3?.bucket !== undefined };
    }
    return config;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Invalid Pilibala config at ${configPath}: ${formatConfigValidationError(error)}`);
    }

    throw error;
  }
}

/** Resolve the same deployment mode without loading config.ts's dotenv/startup side effects. */
export function resolveDeploymentMode(fileConfig = readConfigFile()): DeploymentMode {
  const fromEnv = process.env.PILIBALA_DEPLOYMENT_MODE;
  return fromEnv && DEPLOYMENT_MODES.includes(fromEnv as DeploymentMode)
    ? fromEnv as DeploymentMode
    : fileConfig?.server.deploymentMode ?? "local_trusted";
}
