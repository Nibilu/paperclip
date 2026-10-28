import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHermesAcpConfig,
  nodeVersionMeetsHermesAcpMinimum,
  resolveHermesAcpBillingIdentity,
  resolveHermesExecutionEngineForRun,
} from "./acp.js";
import { execute } from "./execute.js";
import { sessionCodec } from "./index.js";
import { testEnvironment } from "./test.js";

const originalVersion = process.version;
afterEach(() => Object.defineProperty(process, "version", { value: originalVersion }));

describe("hermes engine selection", () => {
  it("defaults to the CLI engine when engine is unset or unknown", async () => {
    await expect(resolveHermesExecutionEngineForRun({ config: {} }))
      .resolves.toMatchObject({ engine: "cli", explicit: false });
    await expect(resolveHermesExecutionEngineForRun({ config: { engine: "sometimes" } }))
      .resolves.toMatchObject({ engine: "cli", explicit: false });
  });

  it("keeps an explicitly selected CLI engine free of ACP prerequisites", async () => {
    Object.defineProperty(process, "version", { value: "v18.0.0" });
    await expect(resolveHermesExecutionEngineForRun({ config: { engine: "cli" } }))
      .resolves.toEqual({ engine: "cli", explicit: true });
  });

  it("reports a setup failure for engine=acp on an unsupported Node without starting a process", async () => {
    Object.defineProperty(process, "version", { value: "v18.0.0" });
    const config = { engine: "acp" };
    const onSpawn = vi.fn();
    const result = await execute({ config, onSpawn } as never);
    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "adapter_engine_unavailable",
      errorMessage: expect.stringContaining("Node v18.0.0"),
      resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } },
    });
    expect(result.errorMessage).toContain(process.execPath);
    expect(onSpawn).not.toHaveBeenCalled();
    const diagnostic = await testEnvironment({ config } as never);
    expect(diagnostic.status).toBe("fail");
    expect(diagnostic.checks).toContainEqual(expect.objectContaining({
      code: "adapter_engine_unavailable", level: "error",
    }));
  });

  it("keeps an unavailable ACP command as a failure, not a CLI selection", async () => {
    Object.defineProperty(process, "version", { value: "v24.11.0" });
    const result = await resolveHermesExecutionEngineForRun({
      config: { engine: "acp", agentCommand: "/nonexistent/pilibala-test/hermes-acp" },
    });
    expect(result.engine).toBe("acp");
    expect(result.unavailableReason).toContain("not available");
  });

  it.each([["v24.11.0", true], ["v24.10.9", false], ["v22.5.0", false], ["v25.0.0", true]])(
    "node %s meets minimum: %s",
    (version, expected) => {
      expect(nodeVersionMeetsHermesAcpMinimum(version)).toBe(expected);
    },
  );
});

describe("hermes acp config mapping", () => {
  it("forces the hermes agent id and forwards an explicit agent command", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      agentCommand: "/opt/hermes/bin/hermes-acp",
      mode: "oneshot",
    });
    expect(mapped).toMatchObject({
      agent: "hermes",
      agentCommand: "/opt/hermes/bin/hermes-acp",
      mode: "oneshot",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    });
  });

  it("pins agentCommand to hermes-acp so the engine never falls back to the bare CLI", () => {
    const mapped = buildHermesAcpConfig({ engine: "acp" });
    expect(mapped.agent).toBe("hermes");
    expect(mapped.agentCommand).toBe("hermes-acp");
  });

  it("accepts hermesCommand as the ACP server command override", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      hermesCommand: "/opt/hermes/bin/hermes-acp",
    });
    expect(mapped.agentCommand).toBe("/opt/hermes/bin/hermes-acp");
  });

  it("reports an honest opaque billing identity instead of guessing a provider", () => {
    expect(resolveHermesAcpBillingIdentity()).toEqual({
      provider: "hermes",
      biller: "hermes",
      billingType: "unknown",
    });
  });
});

describe("hermes session codec (dual engine)", () => {
  it("keeps CLI sessionId params unchanged", () => {
    const params = { sessionId: "session-123" };
    expect(sessionCodec.serialize(params)).toEqual(params);
    expect(sessionCodec.deserialize(params)).toEqual(params);
    expect(sessionCodec.getDisplayId?.(params) ?? null).toBe("session-123");
  });

  it("falls back to the acpx codec for ACP session params", () => {
    const params = {
      acpSessionId: "acp-1",
      configFingerprint: "fp-1",
      sessionKey: "pilibala:c:a:t:fp-1",
      cwd: "/tmp/w",
    };
    const serialized = sessionCodec.serialize(params);
    expect(serialized).toMatchObject({ acpSessionId: "acp-1", configFingerprint: "fp-1" });
    expect(sessionCodec.deserialize(serialized)).toMatchObject({ acpSessionId: "acp-1" });
    expect(sessionCodec.getDisplayId?.(params) ?? null).toBe("acp-1");
  });

  it("returns null for params of neither shape", () => {
    expect(sessionCodec.serialize({})).toBeNull();
    expect(sessionCodec.deserialize({})).toBeNull();
  });
});
