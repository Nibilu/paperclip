import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentCapabilityObservations,
  agentCapabilityUpgradeRequests,
  agents,
  companies,
  createDb,
  issues,
} from "./index.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres upgrade-request schema tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/** Constraint-name assertions keep failures attributable to the intended guard. */
async function expectConstraintError(action: () => Promise<unknown>, constraint: string) {
  try {
    await action();
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause;
    const candidates = [
      (cause as { constraint?: string } | undefined)?.constraint,
      String((cause as Error | undefined)?.message ?? ""),
      String((error as Error).message ?? ""),
    ];
    expect(candidates.some((name) => name?.includes(constraint))).toBe(true);
    return;
  }
  throw new Error(`Expected ${constraint} to reject the insert, but it succeeded.`);
}

describeEmbeddedPostgres("agent capability upgrade request schema", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyA!: { id: string };
  let companyB!: { id: string };
  let agentA!: { id: string };
  let agentB!: { id: string };
  let issueA!: { id: string };
  let issueA2!: { id: string };
  let issueB!: { id: string };
  let observationA1!: { id: string };
  let observationA2!: { id: string };
  let observationB!: { id: string };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-capability-upgrade-");
    db = createDb(tempDb.connectionString);

    [companyA, companyB] = await db
      .insert(companies)
      .values([
        { name: "Upgrade Co A", issuePrefix: "UPA" },
        { name: "Upgrade Co B", issuePrefix: "UPB" },
      ])
      .returning();
    [agentA] = await db
      .insert(agents)
      .values({ companyId: companyA.id, name: "Gateway Agent A", adapterType: "hermes_gateway" })
      .returning();
    [agentB] = await db
      .insert(agents)
      .values({ companyId: companyB.id, name: "Gateway Agent B", adapterType: "hermes_gateway" })
      .returning();
    [issueA] = await db
      .insert(issues)
      .values({ companyId: companyA.id, title: "Upgrade Hermes gateway adapter" })
      .returning();
    [issueA2] = await db
      .insert(issues)
      .values({ companyId: companyA.id, title: "Second upgrade issue in A" })
      .returning();
    [issueB] = await db
      .insert(issues)
      .values({ companyId: companyB.id, title: "Upgrade Hermes gateway adapter" })
      .returning();
    [observationA1] = await db
      .insert(agentCapabilityObservations)
      .values({
        companyId: companyA.id,
        agentId: agentA.id,
        adapterType: "hermes_gateway",
        endpointLabel: "http://127.0.0.1:8642",
        state: "available",
      })
      .returning();
    [observationA2] = await db
      .insert(agentCapabilityObservations)
      .values({
        companyId: companyA.id,
        agentId: agentA.id,
        adapterType: "hermes_gateway",
        endpointLabel: "http://127.0.0.1:8643",
        state: "partially_supported",
      })
      .returning();
    [observationB] = await db
      .insert(agentCapabilityObservations)
      .values({
        companyId: companyB.id,
        agentId: agentB.id,
        adapterType: "hermes_gateway",
        endpointLabel: "http://127.0.0.2:8642",
        state: "available",
      })
      .returning();
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /** Every rejection case below violates exactly one constraint on purpose. */
  function requestFor(input: {
    companyId: string;
    observationId: string;
    issueId: string;
    selectedAgentId: string;
    idempotencyKey: string;
  }) {
    return {
      companyId: input.companyId,
      observationId: input.observationId,
      issueId: input.issueId,
      selectedAgentId: input.selectedAgentId,
      idempotencyKey: input.idempotencyKey,
      diff: [{ kind: "added" as const, scope: "operation" as const, key: "steer" }],
    };
  }

  it("admits one request per observation and rejects a retry with a different key", async () => {
    const [created] = await db
      .insert(agentCapabilityUpgradeRequests)
      .values(
        requestFor({
          companyId: companyA.id,
          observationId: observationA1.id,
          issueId: issueA.id,
          selectedAgentId: agentA.id,
          idempotencyKey: `capability-upgrade:${observationA1.id}`,
        }),
      )
      .returning();
    expect(created.admissionState).toBe("awaiting_user_confirmation");
    expect(created.confirmedAt).toBeNull();
    expect(created.confirmedByUserId).toBeNull();
    expect(created.requestedByAgentId).toBeNull();
    expect(created.requestedByUserId).toBeNull();

    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values(
          requestFor({
            companyId: companyA.id,
            observationId: observationA1.id,
            issueId: issueA2.id,
            selectedAgentId: agentA.id,
            idempotencyKey: "capability-upgrade:retry-after-diff",
          }),
        ),
      "capability_upgrade_observation_uq",
    );
  });

  it("rejects a duplicate idempotency key within the same company", async () => {
    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values(
          requestFor({
            companyId: companyA.id,
            observationId: observationA2.id,
            issueId: issueA2.id,
            selectedAgentId: agentA.id,
            idempotencyKey: `capability-upgrade:${observationA1.id}`,
          }),
        ),
      "capability_upgrade_key_uq",
    );
  });

  it("scopes idempotency keys per company: the same key text in another company is a distinct request", async () => {
    const [companyBRequest] = await db
      .insert(agentCapabilityUpgradeRequests)
      .values(
        requestFor({
          companyId: companyB.id,
          observationId: observationB.id,
          issueId: issueB.id,
          selectedAgentId: agentB.id,
          idempotencyKey: `capability-upgrade:${observationA1.id}`,
        }),
      )
      .returning();
    expect(companyBRequest.companyId).toBe(companyB.id);
    expect(companyBRequest.observationId).toBe(observationB.id);
  });

  it("refuses requests whose observation, issue or selected agent live in another company", async () => {
    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values(
          requestFor({
            companyId: companyA.id,
            observationId: observationB.id,
            issueId: issueA2.id,
            selectedAgentId: agentA.id,
            idempotencyKey: "capability-upgrade:obs-isolation",
          }),
        ),
      "capability_upgrade_observation_fk",
    );
    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values(
          requestFor({
            companyId: companyA.id,
            observationId: observationA2.id,
            issueId: issueB.id,
            selectedAgentId: agentA.id,
            idempotencyKey: "capability-upgrade:issue-isolation",
          }),
        ),
      "capability_upgrade_issue_fk",
    );
    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values(
          requestFor({
            companyId: companyA.id,
            observationId: observationA2.id,
            issueId: issueA2.id,
            selectedAgentId: agentB.id,
            idempotencyKey: "capability-upgrade:agent-isolation",
          }),
        ),
      "capability_upgrade_agent_fk",
    );
  });

  it("keeps admission state consistent with durable user confirmation", async () => {
    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values({
          ...requestFor({
            companyId: companyA.id,
            observationId: observationA2.id,
            issueId: issueA2.id,
            selectedAgentId: agentA.id,
            idempotencyKey: "capability-upgrade:admission-admitted",
          }),
          admissionState: "admitted",
        }),
      "capability_upgrade_admission_check",
    );
    await expectConstraintError(
      () =>
        db.insert(agentCapabilityUpgradeRequests).values({
          ...requestFor({
            companyId: companyA.id,
            observationId: observationA2.id,
            issueId: issueA2.id,
            selectedAgentId: agentA.id,
            idempotencyKey: "capability-upgrade:admission-awaiting",
          }),
          confirmedAt: new Date(),
          confirmedByUserId: "7utg8F0BbzwHr8GRQPYd1dYRsNf35XO8",
        }),
      "capability_upgrade_admission_check",
    );
  });
});
