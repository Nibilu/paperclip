import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { startEmbeddedPostgresTestDatabase, createDb, agents, companies, issues, agentCapabilityObservations, agentCapabilityUpgradeRequests } from "@pilibalaai/db";
import { capabilityUpgradeTaskService } from "./agent-capability-upgrade-task.js";

// Real PostgreSQL, including the generated migration and actual unique/FK checks.
describe("capability persistence boundaries", () => {
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const company = randomUUID(), other = randomUUID(), source = randomUUID(), worker = randomUUID(), foreign = randomUUID();
  let observationId: string;
  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("amb20-capability-");
    db = createDb(temp.connectionString);
    await db.insert(companies).values([{ id: company, name: "capability test", issuePrefix: "CAP" }, { id: other, name: "other", issuePrefix: "OTH" }]);
    await db.insert(agents).values([{ id: source, companyId: company, name: "source", adapterType: "hermes_gateway" }, { id: worker, companyId: company, name: "worker" }, { id: foreign, companyId: other, name: "foreign" }]);
    const [row] = await db.insert(agentCapabilityObservations).values({ companyId: company, agentId: source, adapterType: "hermes_gateway", endpointLabel: "https://example.com", state: "available", operations: { create: { supported: true } }, requestedByUserId: "requester" }).returning();
    observationId = row.id;
  }, 90000);
  afterAll(async () => { await temp?.cleanup(); }, 30000);

  it("rejects cross-company observation targets and requester provenance in PostgreSQL", async () => {
    const base = { companyId: company, agentId: source, adapterType: "hermes_gateway", endpointLabel: "https://example.com", state: "available" };
    await expect(db.insert(agentCapabilityObservations).values({ ...base, agentId: foreign })).rejects.toThrow();
    await expect(db.insert(agentCapabilityObservations).values({ ...base, requestedByAgentId: foreign })).rejects.toThrow();
  });

  it("coalesces concurrent requests across service instances, survives restart, and confirms once", async () => {
    let creations = 0;
    const input = { agentId: source, upgradeAgentId: worker, observationId, requestedByUserId: "requester", requestedByAgentId: source,
      createIssue: async (data: Record<string, unknown>, tx: typeof db) => {
        creations++;
        const [row] = await tx.insert(issues).values({ companyId: company, title: String(data.title), description: String(data.description), status: "todo", assigneeAgentId: worker, executionPolicy: data.executionPolicy as Record<string, unknown> }).returning();
        return { id: row.id, identifier: row.identifier };
      } };
    const results = await Promise.all([capabilityUpgradeTaskService(db).submitUpgradeTask(company, input), capabilityUpgradeTaskService(db).submitUpgradeTask(company, input)]);
    expect(creations).toBe(1);
    expect(results[0].issueId).toBe(results[1].issueId);
    const retry = await capabilityUpgradeTaskService(db).submitUpgradeTask(company, input);
    expect(retry.issueId).toBe(results[0].issueId);
    const [request] = await db.select().from(agentCapabilityUpgradeRequests).where(eq(agentCapabilityUpgradeRequests.issueId, retry.issueId));
    expect(request).toMatchObject({ observationId, selectedAgentId: worker, requestedByUserId: "requester", requestedByAgentId: source, admissionState: "awaiting_user_confirmation" });
    expect(request.diff.length).toBeGreaterThan(0);
    await expect(capabilityUpgradeTaskService(db).submitUpgradeTask(company, { ...input, upgradeAgentId: source })).rejects.toMatchObject({ code: "upgrade_request_conflict" });
    const confirmed = await Promise.all([capabilityUpgradeTaskService(db).confirmUpgradeTask(company, retry.issueId, { confirmedByUserId: "confirmer" }), capabilityUpgradeTaskService(db).confirmUpgradeTask(company, retry.issueId, { confirmedByUserId: "confirmer" })]);
    expect(confirmed.filter(r => r.confirmed)).toHaveLength(1);
    const [saved] = await db.select().from(agentCapabilityUpgradeRequests).where(eq(agentCapabilityUpgradeRequests.id, request.id));
    expect(saved.confirmedByUserId).toBe("confirmer");
    expect(saved.admissionState).toBe("admitted");
    expect(await capabilityUpgradeTaskService(db).listUpgradeTasksForAgent(company, source)).toHaveLength(1);
    expect(await capabilityUpgradeTaskService(db).listUpgradeTasksForAgent(other, source)).toHaveLength(0);
    await expect(db.insert(agentCapabilityUpgradeRequests).values({ ...request, id: randomUUID(), idempotencyKey: "different" })).rejects.toThrow();
    await expect(db.insert(agentCapabilityUpgradeRequests).values({ ...request, id: randomUUID(), companyId: other })).rejects.toThrow();
  });

  it("rejects cross-company issue, observation and selected Agent links", async () => {
    for (const field of ["issueId", "observationId", "selectedAgentId", "requestedByAgentId"] as const) {
      const [localObservation] = await db.insert(agentCapabilityObservations).values({ companyId: company, agentId: source, adapterType: "hermes_gateway", endpointLabel: "local", state: "available", checkedAt: new Date(Date.now()+Math.random()*100000) }).returning();
      const [foreignObservation] = await db.insert(agentCapabilityObservations).values({ companyId: other, agentId: foreign, adapterType: "hermes_gateway", endpointLabel: "other", state: "available", checkedAt: new Date(Date.now()+Math.random()*100000) }).returning();
      const [localIssue, foreignIssue] = await db.insert(issues).values([{ companyId: company, title: "local" }, { companyId: other, title: "foreign" }]).returning();
      const foreignValue = field === "issueId" ? foreignIssue.id : field === "observationId" ? foreignObservation.id : foreign;
      await expect(db.insert(agentCapabilityUpgradeRequests).values({ companyId: company, observationId: localObservation.id, issueId: localIssue.id, selectedAgentId: worker, idempotencyKey: randomUUID(), diff: [], [field]: foreignValue })).rejects.toThrow();
    }
  });

  it("rolls back the ordinary issue if request persistence fails", async () => {
    const [obs] = await db.insert(agentCapabilityObservations).values({ companyId: company, agentId: source, adapterType: "hermes_gateway", endpointLabel: "https://example.com", state: "available", operations: { stop: { supported: true } }, checkedAt: new Date(Date.now()+200000) }).returning();
    const issueId = randomUUID();
    await expect(capabilityUpgradeTaskService(db).submitUpgradeTask(company, { agentId: source, upgradeAgentId: worker, observationId: obs.id, requestedByUserId: "requester", requestedByAgentId: foreign,
      createIssue: async (_data, tx) => { await tx.insert(issues).values({ id: issueId, companyId: company, title: "rollback", status: "todo" }); return { id: issueId, identifier: null }; },
    })).rejects.toThrow();
    expect(await db.select().from(issues).where(and(eq(issues.companyId, company), eq(issues.id, issueId)))).toHaveLength(0);
  });
});
