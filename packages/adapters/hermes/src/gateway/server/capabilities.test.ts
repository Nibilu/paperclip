import { afterEach, describe, expect, it } from "vitest";
import {
  redactCapabilityEvidence,
  capabilityCheckPrerequisites,
  discoverCapabilities,
  mapCapabilityDocument,
  HERMES_CAPABILITY_REVISION_UNVERSIONED,
} from "./capabilities.js";

const VALID_CONFIG = {
  apiBaseUrl: "http://127.0.0.1:8642",
  apiKey: "test-api-server-key",
};

const SAMPLE_CAPABILITIES_DOC = {
  object: "hermes.api_server.capabilities",
  platform: "hermes-agent",
  version: "0.21.1",
  auth: { type: "bearer", required: true },
  runtime: { mode: "server_agent", tool_execution: "server" },
  features: {
    chat_completions: true,
    run_submission: true,
    run_status: true,
    run_events_sse: true,
    run_stop: true,
    run_steer: true,
    run_approval_response: true,
    runs_idempotency: { supported: true, durable: true, retention_seconds: 86400 },
    session_chat: true,
  },
  endpoints: {
    runs: { method: "POST", path: "/v1/runs" },
    run_status: { method: "GET", path: "/v1/runs/{run_id}" },
    run_events: { method: "GET", path: "/v1/runs/{run_id}/events" },
    run_stop: { method: "POST", path: "/v1/runs/{run_id}/stop" },
    run_approval: { method: "POST", path: "/v1/runs/{run_id}/approval" },
  },
};

describe("mapCapabilityDocument", () => {
  it("maps features and endpoints onto the operation vocabulary", () => {
    const mapped = mapCapabilityDocument(SAMPLE_CAPABILITIES_DOC);
    expect(mapped.operations.create).toEqual({ supported: true, endpoint: "POST /v1/runs" });
    expect(mapped.operations.status).toEqual({ supported: true, endpoint: "GET /v1/runs/{run_id}" });
    expect(mapped.operations.stop).toEqual({ supported: true, endpoint: "POST /v1/runs/{run_id}/stop" });
    expect(mapped.operations.approval).toEqual({ supported: true, endpoint: "POST /v1/runs/{run_id}/approval" });
    expect(mapped.operations.idempotency).toEqual({ supported: true, endpoint: "POST /v1/runs" });
    expect(mapped.protocolVersion).toBe("0.21.1");
    // run_steer and session_chat are extras, not admission inputs
    expect(mapped.observedExtras.run_steer).toBe(true);
    expect(mapped.observedExtras.session_chat).toBe(true);
    expect(mapped.observedExtras.run_submission).toBeUndefined();
  });

  it("treats a missing feature flag as unsupported rather than assuming", () => {
    const doc = { features: { run_submission: true }, endpoints: {} };
    const mapped = mapCapabilityDocument(doc);
    expect(mapped.operations.create.supported).toBe(true);
    expect(mapped.operations.status.supported).toBe(false);
    expect(mapped.operations.stop.supported).toBe(false);
  });

  it("survives a document without endpoints (paths become absent, not wrong)", () => {
    const mapped = mapCapabilityDocument({ features: { run_stop: true } });
    expect(mapped.operations.stop).toEqual({ supported: true });
  });
});

describe("discoverCapabilities: config validation", () => {
  it("returns unknown with a structured error when apiBaseUrl is missing", async () => {
    const result = await discoverCapabilities({ config: { apiKey: "k" } });
    expect(result.state).toBe("unknown");
    expect(result.error?.code).toBe("hermes_gateway_api_base_url_missing");
    expect(result.error?.stage).toBe("capability_check");
    expect(result.error?.nextAction).toBeTruthy();
  });

  it("rejects remote plain HTTP without the escape hatch", async () => {
    const result = await discoverCapabilities({
      config: { apiBaseUrl: "http://10.0.0.8:8642", apiKey: "k" },
    });
    expect(result.state).toBe("unreachable");
    expect(result.error?.code).toBe("hermes_gateway_plain_http_remote_denied");
  });

  it("returns unknown when apiKey is missing", async () => {
    const result = await discoverCapabilities({ config: { apiBaseUrl: "http://127.0.0.1:8642" } });
    expect(result.state).toBe("unknown");
    expect(result.error?.code).toBe("hermes_gateway_api_key_missing");
  });

  it("flags prerequisites through the pure helper", () => {
    expect(capabilityCheckPrerequisites({})).toHaveLength(2);
    expect(capabilityCheckPrerequisites(VALID_CONFIG)).toHaveLength(0);
  });
});

describe("discoverCapabilities: live endpoint classes", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchOnce(status: number, body: unknown, headers?: Record<string, string>) {
    globalThis.fetch = (async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers,
      })) as typeof fetch;
  }

  it("sanitizes document, extras, endpoints and revision before returning evidence", async () => {
    mockFetchOnce(200, { ...SAMPLE_CAPABILITIES_DOC, revision: VALID_CONFIG.apiKey,
      features: { ...SAMPLE_CAPABILITIES_DOC.features, extra: { credentials: [{ password: "must-not-persist" }], echo: VALID_CONFIG.apiKey } },
      endpoints: { ...SAMPLE_CAPABILITIES_DOC.endpoints, runs: { method: "POST", path: "/v1/runs?token=endpoint-secret" } } });
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    for (const value of [VALID_CONFIG.apiKey, "must-not-persist", "endpoint-secret"]) expect(JSON.stringify(result)).not.toContain(value);
    expect(result.operations.create.supported).toBe(true);
  });

  it("classifies 401 as authentication_failed", async () => {
    mockFetchOnce(401, { error: { code: "gateway_auth_failed" } });
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("authentication_failed");
    expect(result.error?.code).toBe("hermes_gateway_capability_auth_failed");
    expect(result.document).toBeNull();
  });

  it("classifies 404 as unsupported with an upgrade hint", async () => {
    mockFetchOnce(404, { error: { message: "Not Found" } });
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("unsupported");
    expect(result.error?.code).toBe("hermes_gateway_capability_unsupported");
    expect(result.error?.nextAction).toMatch(/upgrade/i);
  });

  it("classifies 5xx as unreachable, separate from a run failure", async () => {
    mockFetchOnce(503, { error: { message: "unavailable" } });
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("unreachable");
    expect(result.error?.code).toBe("hermes_gateway_capability_http_error");
  });

  it("classifies a non-JSON body as malformed_response", async () => {
    mockFetchOnce(200, "<html>dashboard</html>");
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("malformed_response");
    expect(result.error?.code).toBe("hermes_gateway_capability_malformed");
  });

  it("classifies a document missing features as malformed_response", async () => {
    mockFetchOnce(200, { object: "hermes.api_server.capabilities" });
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("malformed_response");
  });

  it("maps a successful document with an unversioned revision marker", async () => {
    mockFetchOnce(200, SAMPLE_CAPABILITIES_DOC);
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("available");
    expect(result.revision).toBe(HERMES_CAPABILITY_REVISION_UNVERSIONED);
    expect(result.protocolVersion).toBe("0.21.1");
    expect(result.endpointLabel).toBe("http://127.0.0.1:8642");
    expect(result.document).toEqual(SAMPLE_CAPABILITIES_DOC);
    expect(result.error).toBeNull();
    expect(result.operations.create?.supported).toBe(true);
  });

  it("marks partially_supported when no vocabulary operation is supported", async () => {
    mockFetchOnce(200, { features: { chat_completions: true }, endpoints: {} });
    const result = await discoverCapabilities({ config: VALID_CONFIG });
    expect(result.state).toBe("partially_supported");
  });
});


describe("capability evidence redaction", () => {
  it("removes nested secrets, arrays, URL credentials, query secrets and configured values without mutation", () => {
    const raw = { features: { extra: [{ api_key: "nested-value", note: "Bearer another-token", url: "https://user:pass@example.com/a?token=query-value" }] }, revision: "echo configured-secret", auth: { type: "bearer", required: true }, retention_seconds: 86400 };
    const result = redactCapabilityEvidence(raw, ["configured-secret"]);
    const text = JSON.stringify(result);
    for (const value of ["nested-value", "another-token", "user:pass", "query-value", "configured-secret"]) expect(text).not.toContain(value);
    expect(result.auth).toEqual(raw.auth);
    expect(result.retention_seconds).toBe(86400);
    expect(raw.features.extra[0].api_key).toBe("nested-value");
  });
});
