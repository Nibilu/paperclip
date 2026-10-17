
import { describe, expect, it } from "vitest";
import { agentCapabilityObservationSchema, capabilityDiffRequiresUpgradeTask, AGENT_CAPABILITY_OBSERVATION_STATES } from "./agent-capability-observation.js";

describe("agent capability observation contract", () => {
  it("parses a valid observation", () => {
    const parsed = agentCapabilityObservationSchema.safeParse({
      id: "ca2f8516-05a5-41da-8330-1b518c3b0d17",
      companyId: "22bb83e2-4344-4a27-9f32-b853ce198a3e",
      agentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
      adapterType: "hermes_gateway",
      endpointLabel: "http://127.0.0.1:8642",
      state: "available",
      operations: { create: { supported: true, endpoint: "/v1/runs" } },
      checkedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown state", () => {
    const parsed = agentCapabilityObservationSchema.safeParse({
      id: "ca2f8516-05a5-41da-8330-1b518c3b0d17",
      companyId: "22bb83e2-4344-4a27-9f32-b853ce198a3e",
      agentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
      adapterType: "hermes_gateway",
      endpointLabel: "http://127.0.0.1:8642",
      state: "definitely_not_a_state",
      operations: {},
      checkedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });

  it("classifies diff requiring upgrade task", () => {
    expect(capabilityDiffRequiresUpgradeTask([])).toBe(false);
    expect(capabilityDiffRequiresUpgradeTask([{ kind: "unchanged", scope: "operation", key: "create" }])).toBe(false);
    expect(capabilityDiffRequiresUpgradeTask([{ kind: "added", scope: "operation", key: "steer" }])).toBe(true);
    expect(capabilityDiffRequiresUpgradeTask([{ kind: "removed", scope: "endpoint", key: "run_stop" }])).toBe(true);
  });

  it("exposes the 10 SPEC states", () => {
    expect(AGENT_CAPABILITY_OBSERVATION_STATES).toHaveLength(10);
  });
});
