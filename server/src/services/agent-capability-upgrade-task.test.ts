import { describe, expect, it } from "vitest";
import {
  CAPABILITY_UPGRADE_ADMISSION_GATE_REASON,
  type CapabilityUpgradeTaskProvenance,
} from "@pilibalaai/shared";
import { capabilityUpgradeTaskService } from "./agent-capability-upgrade-task.js";

/**
 * HG-A5/A6 unit tests (SPEC-implementation 11.2): upgrade task submission and
 * the pre-dispatch user-confirmation admission gate.
 */

const companyId = "11111111-1111-4111-8111-111111111111";
const sourceAgentId = "22222222-2222-4222-8222-222222222222";
const upgradeAgentId = "33333333-3333-4333-8333-333333333333";
const observationId = "44444444-4444-4444-8444-444444444444";
const upgradeIssueId = "55555555-5555-4555-8555-555555555555";

const provenance: CapabilityUpgradeTaskProvenance = {
  observationId,
  sourceAgentId,
  sourceAdapterType: "hermes_gateway",
  endpointLabel: "http://127.0.0.1:8642",
  capabilityRevision: "rev-1",
  protocolVersion: "0.21.1",
  diff: [
    { kind: "added", scope: "operation", key: "approval", after: { supported: true } },
    { kind: "changed", scope: "endpoint", key: "runs", before: "POST /v1/runs", after: "POST /v2/runs" },
  ],
  requestedByUserId: "user-1",
};

type SelectResult = unknown[];
/** Minimal awaitable drizzle-ish chain; `results` are consumed per select call order. */
function makeDb(selectResults: SelectResult[], hooks: { activity?: (action: string) => void; confirm?: boolean } = {}) {
  let call = 0;
  if (!hooks.confirm) selectResults = [[], ...selectResults];
  const chain = () => {
    const builder = {
      from: () => builder,
      for: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      set: () => builder,
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          hooks.activity?.(String(row.action));
          return [row];
        },
      }),
      whereUpdate: () => builder,
      then: (res: (rows: unknown[]) => unknown) => {
        const rows = selectResults[Math.min(call, selectResults.length - 1)] ?? [];
        call += 1;
        return Promise.resolve(res(rows));
      },
    };
    return builder;
  };
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    execute: async () => [],
    select: chain,
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          hooks.activity?.(String(row.action));
          return [row];
        },
      }),
    }),
  };
  return db as unknown as import("@pilibalaai/db").Db;
}

function makeObservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: observationId,
    companyId,
    agentId: sourceAgentId,
    adapterType: "hermes_gateway",
    endpointLabel: "http://127.0.0.1:8642",
    revision: "rev-1",
    protocolVersion: "0.21.1",
    state: "available",
    operations: { create: { supported: true, endpoint: "POST /v1/runs" } },
    checkedAt: new Date("2026-10-16T03:00:00Z"),
    ...overrides,
  };
}

function makePrevObservationRow() {
  return makeObservationRow({
    id: "77777777-7777-4777-8777-777777777777",
    revision: "rev-0",
    operations: {},
    checkedAt: new Date("2026-10-16T02:00:00Z"),
  });
}

function makePrevObservationRowSameRev() {
  return makeObservationRow({
    id: "77777777-7777-4777-8777-777777777777",
    checkedAt: new Date("2026-10-16T02:00:00Z"),
  });
}

describe("capabilityUpgradeTaskService.submitUpgradeTask", () => {
  it("creates an ordinary todo upgrade task with provenance and an unconfirmed admission gate", async () => {
    const createdIssues: Array<Record<string, unknown>> = [];
    const activityActions: string[] = [];

    const db = makeDb(
      [
        [{ id: sourceAgentId, companyId, adapterType: "hermes_gateway" }], // source agent
        [{ id: upgradeAgentId, companyId, adapterType: "hermes_gateway" }], // upgrade agent
        [makeObservationRow()], // observation by id
        [makePrevObservationRow(), makeObservationRow()], // history (raw rows)
      ],
      { activity: (action) => activityActions.push(action) },
    );

    const svc = capabilityUpgradeTaskService(db);
    const result = await svc.submitUpgradeTask(companyId, {
      agentId: sourceAgentId,
      upgradeAgentId,
      observationId,
      requestedByUserId: "user-1",
      createIssue: async (data) => {
        createdIssues.push(data as Record<string, unknown>);
        return { id: upgradeIssueId, identifier: "PAP-2" };
      },
    });

    expect(createdIssues).toHaveLength(1);
    const issue = createdIssues[0];
    expect(issue.status).toBe("todo");
    expect(issue.assigneeAgentId).toBe(upgradeAgentId);
    const policy = issue.executionPolicy as Record<string, unknown>;
    expect(policy.admissionGate).toMatchObject({
      reason: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON,
      confirmedAt: null,
    });
    const description = String(issue.description);
    expect(description).toContain("capability-upgrade-provenance");
    expect(description).toContain(`"observationId":"${observationId}"`);
    expect(description).toContain("**added** operation `create`");
    expect(description).toContain("**changed** revision");
    expect(description).toContain("fresh manual capability check");
    expect(result).toMatchObject({ issueId: upgradeIssueId, identifier: "PAP-2", status: "todo" });
    expect(activityActions).toContain("agent_capability_upgrade_task_created");
  });

  it("refuses to submit when the latest check has no concrete capability gap", async () => {
    const db = makeDb([
      [{ id: sourceAgentId, companyId, adapterType: "hermes_gateway" }],
      [{ id: upgradeAgentId, companyId, adapterType: "hermes_gateway" }],
      [makeObservationRow()],
      [makePrevObservationRowSameRev(), makeObservationRow()], // two identical-rev rows → only unchanged entries
    ]);

    const svc = capabilityUpgradeTaskService(db);
    await expect(
      svc.submitUpgradeTask(companyId, {
        agentId: sourceAgentId,
        upgradeAgentId,
        observationId,
        requestedByUserId: "user-1",
        createIssue: async () => ({ id: upgradeIssueId, identifier: "PAP-3" }),
      }),
    ).rejects.toMatchObject({ code: "no_capability_gap" });
  });

  it("refuses stale observations (not the agent's latest check)", async () => {
    const otherObservationId = "66666666-6666-4666-8666-666666666666";
    const db = makeDb([
      [{ id: sourceAgentId, companyId, adapterType: "hermes_gateway" }],
      [{ id: upgradeAgentId, companyId, adapterType: "hermes_gateway" }],
      [makeObservationRow()],
      [makeObservationRow({ id: otherObservationId, checkedAt: new Date("2026-10-16T04:00:00Z") })], // newer check exists
    ]);

    const svc = capabilityUpgradeTaskService(db);
    await expect(
      svc.submitUpgradeTask(companyId, {
        agentId: sourceAgentId,
        upgradeAgentId,
        observationId,
        requestedByUserId: "user-1",
        createIssue: async () => ({ id: upgradeIssueId, identifier: "PAP-4" }),
      }),
    ).rejects.toMatchObject({ code: "observation_stale" });
  });

  it("refuses an upgrade agent outside the company", async () => {
    const db = makeDb([
      [{ id: sourceAgentId, companyId, adapterType: "hermes_gateway" }],
      [], // upgrade agent not found
    ]);

    const svc = capabilityUpgradeTaskService(db);
    await expect(
      svc.submitUpgradeTask(companyId, {
        agentId: sourceAgentId,
        upgradeAgentId,
        observationId,
        requestedByUserId: "user-1",
        createIssue: async () => ({ id: upgradeIssueId, identifier: "PAP-5" }),
      }),
    ).rejects.toMatchObject({ code: "upgrade_agent_not_found" });
  });
});

describe("capabilityUpgradeTaskService.confirmUpgradeTask", () => {
  it("confirms a gated task, stamping confirmedAt idempotently", async () => {
    const gatePolicy = {
      admissionGate: { reason: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON, confirmedAt: null },
    };
    const db = makeDb([
      [{ id: upgradeIssueId, confirmedAt: null }],
      [{ id: upgradeIssueId, status: "todo", executionPolicy: gatePolicy }], // current read
    ], { confirm: true });

    const svc = capabilityUpgradeTaskService(db);
    const result = await svc.confirmUpgradeTask(companyId, upgradeIssueId, { confirmedByUserId: "user-1" });
    expect(result.confirmed).toBe(true);
    expect(typeof result.confirmedAt).toBe("string");
  });

  it("is a no-op when the durable request was already confirmed", async () => {
    const db = makeDb([[{ id: upgradeIssueId, confirmedAt: new Date("2026-10-17T00:00:00Z") }]], { confirm: true });
    const result = await capabilityUpgradeTaskService(db).confirmUpgradeTask(companyId, upgradeIssueId, { confirmedByUserId: "user-1" });
    expect(result).toEqual({ confirmed: false, confirmedAt: "2026-10-17T00:00:00.000Z" });
  });

  it("refuses tasks that are not in todo status", async () => {
    const gatePolicy = {
      admissionGate: { reason: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON, confirmedAt: null },
    };
    const db = makeDb([[{ id: upgradeIssueId, confirmedAt: null }], [{ id: upgradeIssueId, status: "in_progress", executionPolicy: gatePolicy }]], { confirm: true });
    const svc = capabilityUpgradeTaskService(db);
    await expect(
      svc.confirmUpgradeTask(companyId, upgradeIssueId, { confirmedByUserId: "user-1" }),
    ).rejects.toMatchObject({ code: "task_not_gated" });
  });
});
