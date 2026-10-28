import { asString } from "@pilibalaai/adapter-utils/server-utils";
import {
  allowsInsecureRemoteHttp,
  isLoopbackHostname,
  isRemotePlainHttp,
} from "./transport-security.js";

/**
 * Bounded authenticated capability discovery for the Hermes Gateway adapter
 * (SPEC-implementation 11.2). This is a read-only probe: it never starts an
 * agent task and never mutates provider state. The result is adapter-specific
 * evidence, not a task status.
 */

export const HERMES_CAPABILITY_DISCOVERY_TIMEOUT_MS = 5_000;
export const HERMES_CAPABILITY_REVISION_UNVERSIONED = "unversioned";

/** Pilibala admission operation vocabulary (mirrors @pilibalaai/shared). */
export const AGENT_CAPABILITY_OPERATIONS = [
  "create",
  "status",
  "events",
  "stop",
  "approval",
  "idempotency",
] as const;

export interface AgentCapabilityOperationState {
  supported: boolean;
  endpoint?: string;
  detail?: string;
}

export interface AgentCapabilityObservationError {
  code: string;
  stage: string;
  message?: string;
  nextAction?: string;
}

export type AgentCapabilityObservationState =
  | "unknown"
  | "checking"
  | "available"
  | "partially_supported"
  | "unsupported"
  | "stale"
  | "unreachable"
  | "authentication_failed"
  | "protocol_incompatible"
  | "malformed_response";

export interface HermesCapabilityDiscoveryInput {
  config: Record<string, unknown>;
  /** Optional tighter deadline; defaults to the module timeout. */
  timeoutMs?: number;
}

export interface HermesCapabilityDiscoveryResult {
  state: AgentCapabilityObservationState;
  revision: string;
  protocolVersion: string | null;
  endpointLabel: string;
  operations: Record<string, AgentCapabilityOperationState>;
  error: AgentCapabilityObservationError | null;
  /** Redacted capability document when the probe succeeded. */
  document: Record<string, unknown> | null;
  /** Features observed outside Pilibala's operation vocabulary. */
  observedExtras: Record<string, unknown> | null;
  checkedAt: string;
}

function normalizeBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

function endpointLabel(baseUrl: URL): string {
  return `${baseUrl.protocol}//${baseUrl.host}`;
}

function failure(
  state: AgentCapabilityObservationState,
  code: string,
  stage: string,
  message: string,
  nextAction: string,
): HermesCapabilityDiscoveryResult {
  return {
    state,
    revision: HERMES_CAPABILITY_REVISION_UNVERSIONED,
    protocolVersion: null,
    endpointLabel: "",
    operations: {},
    error: { code, stage, message, nextAction },
    document: null,
    observedExtras: null,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Map the live Hermes capability document onto Pilibala's operation
 * vocabulary. Operation availability derives from `features`; endpoint
 * identity derives from the `endpoints` map so a Gateway path change surfaces
 * as a changed capability rather than being silently assumed.
 */
export function mapCapabilityDocument(doc: Record<string, unknown>): {
  operations: Record<string, AgentCapabilityOperationState>;
  observedExtras: Record<string, unknown>;
  protocolVersion: string | null;
} {
  const features = asRecord(doc.features) ?? {};
  const endpoints = asRecord(doc.endpoints) ?? {};

  const operationSources: Record<string, { feature: string; endpointKey: string }> = {
    create: { feature: "run_submission", endpointKey: "runs" },
    status: { feature: "run_status", endpointKey: "run_status" },
    events: { feature: "run_events_sse", endpointKey: "run_events" },
    stop: { feature: "run_stop", endpointKey: "run_stop" },
    approval: { feature: "run_approval_response", endpointKey: "run_approval" },
    idempotency: { feature: "runs_idempotency", endpointKey: "runs" },
  };

  const operations: Record<string, AgentCapabilityOperationState> = {};
  for (const op of AGENT_CAPABILITY_OPERATIONS) {
    const source = operationSources[op];
    const featureValue = features[source.feature];
    const supported =
      typeof featureValue === "boolean"
        ? featureValue
        : asRecord(featureValue)?.supported === true;
    const endpointRecord = asRecord(endpoints[source.endpointKey]);
    const method = nonEmpty(endpointRecord?.method);
    const path = nonEmpty(endpointRecord?.path);
    operations[op] = {
      supported,
      ...(method && path ? { endpoint: `${method} ${path}` } : {}),
    };
  }

  // Everything outside the Pilibala vocabulary is recorded as observed
  // extras, never as admission input (SPEC 11.2 mapping rule).
  const knownFeatureKeys = new Set(Object.values(operationSources).map((s) => s.feature));
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(features)) {
    if (!knownFeatureKeys.has(key)) extras[key] = value;
  }

  const protocolVersion = nonEmpty(doc.version) ?? nonEmpty(doc.protocol_version) ?? nonEmpty(doc.protocolVersion);
  return { operations, observedExtras: extras, protocolVersion };
}

/** Sanitize all evidence before mapping it into document, extras or operations.
 * JSON input only. Also remove exact configured secrets even under unknown keys.
 */
export function redactCapabilityEvidence<T>(value: T, secrets: string[] = []): T {
  const sensitive = /authorization|cookie|password|passwd|secret|token|credential|api[_-]?key|private[_-]?key/i;
  function visit(input: unknown): unknown {
    if (typeof input === "string") {
      let text = input;
      for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
        text = text.split(secret).join("[REDACTED]");
      }
      return text
        .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, "$1 [REDACTED]")
        .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
        .replace(/([?&](?:[^=&\s]*(?:token|key|secret|password|credential|signature)[^=&\s]*)=)[^&#\s]*/gi, "$1[REDACTED]");
    }
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([key, child]) => [
        String(visit(key)), sensitive.test(key) ? "[REDACTED]" : visit(child),
      ]));
    }
    return input;
  }
  return visit(value) as T;
}

/** Bounded authenticated capability check. Never starts a run; never mutates state. */
export async function discoverCapabilities(
  input: HermesCapabilityDiscoveryInput,
): Promise<HermesCapabilityDiscoveryResult> {
  const apiBaseUrl = asString(input.config.apiBaseUrl ?? input.config.url, "").trim();
  const apiKey = asString(input.config.apiKey ?? input.config.token, "").trim();

  if (!apiBaseUrl) {
    return failure(
      "unknown",
      "hermes_gateway_api_base_url_missing",
      "capability_check",
      "Hermes Gateway adapter requires apiBaseUrl.",
      "Set adapterConfig.apiBaseUrl to the Hermes API server address.",
    );
  }
  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  if (!baseUrl) {
    return failure(
      "unknown",
      "hermes_gateway_api_base_url_invalid",
      "capability_check",
      "Invalid Hermes gateway apiBaseUrl.",
      "Set adapterConfig.apiBaseUrl to an http:// or https:// URL.",
    );
  }
  if (isRemotePlainHttp(baseUrl) && !allowsInsecureRemoteHttp(input.config)) {
    return failure(
      "unreachable",
      "hermes_gateway_plain_http_remote_denied",
      "capability_check",
      `Remote plain HTTP gateway ${endpointLabel(baseUrl)} is denied.`,
      "Use HTTPS for remote gateways; loopback HTTP remains allowed.",
    );
  }
  if (!apiKey) {
    return failure(
      "unknown",
      "hermes_gateway_api_key_missing",
      "capability_check",
      "Hermes Gateway adapter requires apiKey.",
      "Set adapterConfig.apiKey to the Hermes API_SERVER_KEY.",
    );
  }

  const label = endpointLabel(baseUrl);
  const timeoutMs = input.timeoutMs ?? HERMES_CAPABILITY_DISCOVERY_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(`${label}/v1/capabilities`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return failure(
      "unreachable",
      timedOut ? "hermes_gateway_capability_timeout" : "hermes_gateway_capability_unreachable",
      "capability_check",
      timedOut ? `Capability check timed out after ${timeoutMs}ms.` : "Capability endpoint could not be reached.",
      "Check apiBaseUrl and that the Hermes API server is reachable from Pilibala.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failure(
      "authentication_failed",
      "hermes_gateway_capability_auth_failed",
      "capability_check",
      `Capability endpoint returned HTTP ${response.status}.`,
      "Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway.",
    );
  }
  if (response.status === 404) {
    return failure(
      "unsupported",
      "hermes_gateway_capability_unsupported",
      "capability_check",
      "Gateway does not expose GET /v1/capabilities.",
      "Upgrade the Hermes Gateway to a version that serves the capability document.",
    );
  }
  if (!response.ok) {
    return failure(
      "unreachable",
      "hermes_gateway_capability_http_error",
      "capability_check",
      `Capability endpoint returned HTTP ${response.status}.`,
      "Retry the manual capability check; if it persists, check gateway health.",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failure(
      "malformed_response",
      "hermes_gateway_capability_malformed",
      "capability_check",
      "Capability endpoint returned a non-JSON body.",
      "Check that the configured URL points at the Hermes API server, not the dashboard UI.",
    );
  }

  const doc = asRecord(redactCapabilityEvidence(body, [apiKey]));
  if (!doc) {
    return failure(
      "malformed_response",
      "hermes_gateway_capability_malformed",
      "capability_check",
      "Capability document is not a JSON object.",
      "Check Hermes Gateway version compatibility.",
    );
  }

  const features = asRecord(doc.features);
  if (!features) {
    return failure(
      "malformed_response",
      "hermes_gateway_capability_malformed",
      "capability_check",
      "Capability document is missing the features map.",
      "Check Hermes Gateway version compatibility.",
    );
  }

  const { operations, observedExtras, protocolVersion: docVersion } = mapCapabilityDocument(doc);
  const anySupported = Object.values(operations).some((op) => op.supported);
  const state: AgentCapabilityObservationState = anySupported ? "available" : "partially_supported";

  // The document carries no revision yet (verified against v0.21.1); derive
  // freshness from check time and mark the revision as unversioned.
  const revision = nonEmpty(doc.revision) ?? nonEmpty(doc.capability_revision) ?? HERMES_CAPABILITY_REVISION_UNVERSIONED;

  // SPEC 11.2 fallback: the capability document may omit a protocol version;
  // fall back to GET /health's version field, recorded as evidence either way.
  let protocolVersion = docVersion;
  if (!protocolVersion) {
    try {
      const healthResponse = await fetch(`${label}/health`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (healthResponse.ok) {
        const health = asRecord(await healthResponse.json());
        protocolVersion = nonEmpty(redactCapabilityEvidence(health?.version, [apiKey]));
      }
    } catch {
      // Liveness fallback is best-effort only; a failure here must not mask
      // the successful capability document.
    }
  }

  // The entire evidence tree was sanitized before mapping above.

  return {
    state,
    revision,
    protocolVersion,
    endpointLabel: label,
    operations,
    error: null,
    document: doc,
    observedExtras,
    checkedAt: new Date().toISOString(),
  };
}

/** Whether a manual check may run against this config at all (transport + fields). */
export function capabilityCheckPrerequisites(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const apiBaseUrl = asString(config.apiBaseUrl ?? config.url, "").trim();
  const baseUrl = apiBaseUrl ? normalizeBaseUrl(apiBaseUrl) : null;
  if (!apiBaseUrl) problems.push("apiBaseUrl is required.");
  else if (!baseUrl) problems.push("apiBaseUrl must be an http:// or https:// URL.");
  else if (isRemotePlainHttp(baseUrl) && !allowsInsecureRemoteHttp(config) && !isLoopbackHostname(baseUrl.hostname)) {
    problems.push("Remote plain HTTP gateways require the insecure-transport escape hatch; use HTTPS.");
  }
  if (!asString(config.apiKey ?? config.token, "").trim()) problems.push("apiKey is required.");
  return problems;
}
