import os from "node:os";
import path from "node:path";

export const DEFAULT_PILIBALA_INSTANCE_ID = "default";
export const PILIBALA_CONFIG_BASENAME = "config.json";
export const PILIBALA_ENV_FILENAME = ".env";

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolvePilibalaHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.PILIBALA_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return path.resolve(os.homedir(), ".pilibala");
}

export function resolvePilibalaInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.PILIBALA_INSTANCE_ID?.trim() || DEFAULT_PILIBALA_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid PILIBALA_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolvePilibalaInstanceRoot(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaHomeDir(input.homeDir), "instances", resolvePilibalaInstanceId(input.instanceId));
}

export function resolvePilibalaInstanceConfigPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaInstanceRoot(input), PILIBALA_CONFIG_BASENAME);
}

export function resolvePilibalaConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolvePilibalaInstanceConfigPath(input);
}

export function resolvePilibalaEnvPathForConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), PILIBALA_ENV_FILENAME);
}

export function resolveDefaultEmbeddedPostgresDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaInstanceRoot(input), "db");
}

export function resolveDefaultLogsDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaInstanceRoot(input), "logs");
}

export function resolveDefaultSecretsKeyFilePath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaInstanceRoot(input), "secrets", "master.key");
}

export function resolveDefaultStorageDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaInstanceRoot(input), "data", "storage");
}

export function resolveDefaultBackupDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolvePilibalaInstanceRoot(input), "data", "backups");
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
