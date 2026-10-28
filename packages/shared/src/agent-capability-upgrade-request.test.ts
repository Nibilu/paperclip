import { describe, expect, it } from "vitest";
import {
  agentCapabilityUpgradeRequestSchema,
  capabilityUpgradeRequestKey,
} from "./agent-capability-upgrade-request.js";

const uuids = {
  id: "1e34f6a2-6a11-4a08-9f0e-2f4f1c0a9b01",
  companyId: "22bb83e2-4344-4a27-9f32-b853ce198a3e",
  observationId: "0dae7639-0d8d-4570-af05-1609a60e8353",
  issueId: "bdaafdf4-203f-4e92-9493-8d3059db1b75",
  selectedAgentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
  requestedByAgentId: "1da6bb73-a11c-4294-9c59-159f3b88e2a4",
};

function baseRequest() {
  return {
    id: uuids.id,
    companyId: uuids.companyId,
    observationId: uuids.observationId,
    issueId: uuids.issueId,
    selectedAgentId: uuids.selectedAgentId,
    idempotencyKey: capabilityUpgradeRequestKey(uuids.observationId),
    diff: [{ kind: "added", scope: "operation", key: "steer" }],
    requestedByUserId: null,
    requestedByAgentId: uuids.requestedByAgentId,
    createdAt: new Date().toISOString(),
    admissionState: "awaiting_user_confirmation",
    confirmedAt: null,
    confirmedByUserId: null,
  };
}

describe("agent capability upgrade request contract", () => {
  it("parses a request awaiting user confirmation", () => {
    const parsed = agentCapabilityUpgradeRequestSchema.safeParse(baseRequest());
    expect(parsed.success).toBe(true);
  });

  it("parses an admitted request backed by durable user confirmation", () => {
    const parsed = agentCapabilityUpgradeRequestSchema.safeParse({
      ...baseRequest(),
      admissionState: "admitted",
      confirmedAt: new Date().toISOString(),
      confirmedByUserId: "7utg8F0BbzwHr8GRQPYd1dYRsNf35XO8",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects admitted without durable confirmation", () => {
    const parsed = agentCapabilityUpgradeRequestSchema.safeParse({
      ...baseRequest(),
      admissionState: "admitted",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects awaiting_user_confirmation that already carries confirmation metadata", () => {
    const parsed = agentCapabilityUpgradeRequestSchema.safeParse({
      ...baseRequest(),
      confirmedAt: new Date().toISOString(),
      confirmedByUserId: "7utg8F0BbzwHr8GRQPYd1dYRsNf35XO8",
    });
    expect(parsed.success).toBe(false);
  });

  it("derives one stable idempotency key per observation", () => {
    expect(capabilityUpgradeRequestKey(uuids.observationId)).toBe(
      `capability-upgrade:${uuids.observationId}`,
    );
    expect(capabilityUpgradeRequestKey(uuids.observationId)).toBe(
      capabilityUpgradeRequestKey(uuids.observationId),
    );
  });
});
