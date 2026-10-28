import { describe, expect, it } from "vitest";
import { diffObservations } from "./agent-capability-check.js";
import type { AgentCapabilityObservation } from "@pilibalaai/shared";

function obs(overrides: Partial<AgentCapabilityObservation> = {}): AgentCapabilityObservation {
  return {
    id: "ca2f8516-05a5-41da-8330-1b518c3b0d17",
    companyId: "22bb83e2-4344-4a27-9f32-b853ce198a3e",
    agentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
    adapterType: "hermes_gateway",
    endpointLabel: "http://127.0.0.1:8642",
    revision: "unversioned",
    state: "available",
    operations: {
      create: { supported: true, endpoint: "POST /v1/runs" },
      status: { supported: true, endpoint: "GET /v1/runs/{run_id}" },
      stop: { supported: true, endpoint: "POST /v1/runs/{run_id}/stop" },
    },
    checkedAt: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("diffObservations", () => {
  it("treats a first-ever observation as all added", () => {
    const diff = diffObservations(null, obs());
    expect(diff).toHaveLength(3);
    expect(diff.every((entry) => entry.kind === "added")).toBe(true);
  });

  it("returns unchanged entries when nothing differs", () => {
    const diff = diffObservations(obs(), obs({ id: "8b91d8ac-1f87-4d57-9dd3-7b13dd384d6b" }));
    expect(diff).toHaveLength(3);
    expect(diff.every((entry) => entry.kind === "unchanged")).toBe(true);
  });

  it("flags a newly supported operation as added", () => {
    const previous = obs({
      operations: { create: { supported: true, endpoint: "POST /v1/runs" } },
    });
    const fresh = obs({
      operations: {
        create: { supported: true, endpoint: "POST /v1/runs" },
        steer: { supported: true, endpoint: "POST /v1/runs/{run_id}/steer" },
      },
    });
    const diff = diffObservations(previous, fresh);
    const added = diff.find((entry) => entry.key === "steer");
    expect(added?.kind).toBe("added");
    expect(added?.scope).toBe("operation");
  });

  it("flags a removed operation", () => {
    const previous = obs();
    const fresh = obs({
      operations: {
        create: { supported: true, endpoint: "POST /v1/runs" },
        status: { supported: true, endpoint: "GET /v1/runs/{run_id}" },
      },
    });
    const diff = diffObservations(previous, fresh);
    expect(diff.find((entry) => entry.key === "stop")?.kind).toBe("removed");
  });

  it("flags an endpoint path change as changed capability", () => {
    const previous = obs();
    const fresh = obs({
      operations: {
        create: { supported: true, endpoint: "POST /v2/runs" },
        status: { supported: true, endpoint: "GET /v1/runs/{run_id}" },
        stop: { supported: true, endpoint: "POST /v1/runs/{run_id}/stop" },
      },
    });
    const diff = diffObservations(previous, fresh);
    const changed = diff.find((entry) => entry.key === "create");
    expect(changed?.kind).toBe("changed");
    expect(changed?.after).toEqual({ supported: true, endpoint: "POST /v2/runs" });
  });

  it("flags a revision change", () => {
    const diff = diffObservations(obs(), obs({ revision: "2026.10" }));
    expect(diff.find((entry) => entry.scope === "revision")?.kind).toBe("changed");
  });

  it("flags a newly present protocol version as added", () => {
    const diff = diffObservations(obs(), obs({ protocolVersion: "0.21.1" }));
    const entry = diff.find((e) => e.scope === "protocol");
    expect(entry?.kind).toBe("added");
    expect(entry?.after).toBe("0.21.1");
  });

  it("does not create a duplicate upgrade-task trigger for unchanged capabilities", () => {
    const diff = diffObservations(obs(), obs({ id: "8b91d8ac-1f87-4d57-9dd3-7b13dd384d6b" }));
    expect(diff.some((entry) => entry.kind !== "unchanged")).toBe(false);
  });
});
