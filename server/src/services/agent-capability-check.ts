import { and, desc, eq } from "drizzle-orm";
import { agentCapabilityObservations, agents, type Db } from "@paperclipai/db";
import {
  type AgentCapabilityDiffEntry,
  type AgentCapabilityObservation,
  capabilityDiffRequiresUpgradeTask,
  agentCapabilityObservationSchema,
} from "@paperclipai/shared";
import type {
  HermesCapabilityDiscoveryResult,
} from "@paperclipai/hermes-paperclip-adapter/gateway/server";

import { logActivity } from "./activity-log.js";
import { secretService } from "./secrets.js";

/**
 * Company-scoped manual capability check (SPEC-implementation 11.2).
 * Explicit user action only: bounded authenticated probe -> observation
 * persistence -> diff against the previous stored observation -> audit event.
 * No periodic checker, no enqueue, no task-status mutation.
 */

/** In-flight check serialization per agent: duplicate clicks coalesce, not parallel probes. */
const inFlightChecks = new Map<string, Promise<AgentCapabilityObservation>>();

function endpointLabelOf(config: Record<string, unknown>): string {
  const raw = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl : typeof config.url === "string" ? config.url : "";
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "unknown";
  }
}

export function toObservation(
  row: typeof agentCapabilityObservations.$inferSelect,
): AgentCapabilityObservation {
  return agentCapabilityObservationSchema.parse({
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    adapterType: row.adapterType,
    endpointLabel: row.endpointLabel,
    revision: row.revision,
    ...(row.protocolVersion ? { protocolVersion: row.protocolVersion } : {}),
    state: row.state,
    operations: row.operations ?? {},
    ...(row.error ? { error: row.error as AgentCapabilityObservation["error"] } : {}),
    ...(row.observedExtras ? { observedExtras: row.observedExtras } : {}),
    checkedAt: row.checkedAt.toISOString(),
    ...(row.freshnessDeadline ? { freshnessDeadline: row.freshnessDeadline.toISOString() } : {}),
  });
}

/** Compare a fresh observation against the previous stored one (revision, protocol, per-operation availability + endpoints). */
export function diffObservations(
  previous: AgentCapabilityObservation | null,
  fresh: AgentCapabilityObservation,
): AgentCapabilityDiffEntry[] {
  if (!previous) {
    return Object.entries(fresh.operations).map(([key, op]) => ({
      kind: "added" as const,
      scope: "operation" as const,
      key,
      after: op,
    }));
  }
  const entries: AgentCapabilityDiffEntry[] = [];
  if (previous.revision !== fresh.revision) {
    entries.push({ kind: "changed", scope: "revision", key: "revision", before: previous.revision, after: fresh.revision });
  }
  if ((previous.protocolVersion ?? null) !== (fresh.protocolVersion ?? null)) {
    entries.push({
      kind: (previous.protocolVersion ?? null) === null ? "added" : "changed",
      scope: "protocol",
      key: "protocolVersion",
      before: previous.protocolVersion ?? null,
      after: fresh.protocolVersion ?? null,
    });
  }
  const operationKeys = new Set([...Object.keys(previous.operations), ...Object.keys(fresh.operations)]);
  for (const key of operationKeys) {
    const before = previous.operations[key];
    const after = fresh.operations[key];
    if (!before && after) {
      entries.push({ kind: "added", scope: "operation", key, after });
    } else if (before && !after) {
      entries.push({ kind: "removed", scope: "operation", key, before });
    } else if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
      entries.push({ kind: "changed", scope: "operation", key, before, after });
    } else if (before && after) {
      entries.push({ kind: "unchanged", scope: "operation", key });
    }
  }
  return entries;
}

export function capabilityCheckService(db: Db) {
  const secrets = secretService(db);

  /** Latest observation for an agent+adapter, or null. */
  async function latestObservation(
    companyId: string,
    agentId: string,
    adapterType = "hermes_gateway",
  ): Promise<AgentCapabilityObservation | null> {
    const [row] = await db
      .select()
      .from(agentCapabilityObservations)
      .where(
        and(
          eq(agentCapabilityObservations.companyId, companyId),
          eq(agentCapabilityObservations.agentId, agentId),
          eq(agentCapabilityObservations.adapterType, adapterType),
        ),
      )
      .orderBy(desc(agentCapabilityObservations.checkedAt))
      .limit(1);
    return row ? toObservation(row) : null;
  }

  async function observationHistory(
    companyId: string,
    agentId: string,
    adapterType = "hermes_gateway",
    limit = 20,
  ): Promise<AgentCapabilityObservation[]> {
    const rows = await db
      .select()
      .from(agentCapabilityObservations)
      .where(
        and(
          eq(agentCapabilityObservations.companyId, companyId),
          eq(agentCapabilityObservations.agentId, agentId),
          eq(agentCapabilityObservations.adapterType, adapterType),
        ),
      )
      .orderBy(desc(agentCapabilityObservations.checkedAt))
      .limit(limit);
    return rows.map(toObservation);
  }

  /**
   * Run one explicit manual capability check. Serialized per agent+adapter so
   * duplicate button clicks coalesce onto the in-flight probe. Persists the
   * observation, computes the diff, and writes the audit event.
   */
  async function runManualCheck(input: {
    companyId: string;
    agentId: string;
    requestedByUserId?: string | null;
    requestedByAgentId?: string | null;
  }): Promise<{ observation: AgentCapabilityObservation; diff: AgentCapabilityDiffEntry[]; upgradeTaskRequired: boolean }> {
    const key = `${input.companyId}:${input.agentId}:hermes_gateway`;
    const existing = inFlightChecks.get(key);
    if (existing) {
      const observation = await existing;
      return { observation, diff: [], upgradeTaskRequired: false };
    }

    const check = (async (): Promise<AgentCapabilityObservation> => {
      const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)))
        .limit(1);
      if (!agent) throw Object.assign(new Error("Agent not found"), { code: "agent_not_found" });
      if (agent.adapterType !== "hermes_gateway") {
        throw Object.assign(new Error(`Capability discovery unsupported for adapter ${agent.adapterType}`), {
          code: "capability_discovery_unsupported",
        });
      }

      // Resolve the stored adapter config to real runtime values (secrets
      // resolved server-side; never logged, never persisted).
      const responsibleUserId = input.requestedByUserId ?? null;
      const { config } = await secrets.resolveAdapterConfigForRuntime(
        input.companyId,
        agent.adapterConfig ?? {},
        {
          consumerType: "agent",
          consumerId: agent.id,
          actorType: input.requestedByAgentId ? ("agent" as const) : ("user" as const),
          actorId: input.requestedByAgentId ?? input.requestedByUserId ?? "capability-check",
          responsibleUserId,
        },
        { adapterType: agent.adapterType },
      );

      // Dynamic import keeps the probe module out of the server startup path.
      const { discoverCapabilities } = await import("@paperclipai/hermes-paperclip-adapter/gateway/server");
      const result: HermesCapabilityDiscoveryResult = await discoverCapabilities({ config });

      const [row] = await db
        .insert(agentCapabilityObservations)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          adapterType: "hermes_gateway",
          endpointLabel: result.endpointLabel || endpointLabelOf(config),
          revision: result.revision,
          protocolVersion: result.protocolVersion,
          state: result.state,
          operations: result.operations as Record<string, unknown>,
          error: (result.error ?? null) as Record<string, unknown> | null,
          document: (result.document ?? null) as Record<string, unknown> | null,
          observedExtras: (result.observedExtras ?? null) as Record<string, unknown> | null,
          checkedAt: new Date(result.checkedAt),
          freshnessDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          requestedByUserId: input.requestedByUserId ?? null,
          requestedByAgentId: input.requestedByAgentId ?? null,
        })
        .returning();

      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.requestedByAgentId ? "agent" : "user",
        actorId: input.requestedByAgentId ?? input.requestedByUserId ?? "system",
        action: result.error ? "agent_capability_check_failed" : "agent_capability_check_completed",
        entityType: "agent",
        entityId: input.agentId,
        agentId: input.agentId,
        details: {
          adapterType: "hermes_gateway",
          state: result.state,
          revision: result.revision,
          protocolVersion: result.protocolVersion,
          endpointLabel: row.endpointLabel,
          error: result.error ?? null,
        },
      });

      return toObservation(row);
    })().finally(() => {
      inFlightChecks.delete(key);
    });

    inFlightChecks.set(key, check);
    const observation = await check;

    const previous = await latestObservationBefore(input.companyId, input.agentId, observation);
    const diff = diffObservations(previous, observation);
    const upgradeTaskRequired = capabilityDiffRequiresUpgradeTask(diff);
    return { observation, diff, upgradeTaskRequired };
  }

  async function latestObservationBefore(
    companyId: string,
    agentId: string,
    fresh: AgentCapabilityObservation,
    adapterType = "hermes_gateway",
  ): Promise<AgentCapabilityObservation | null> {
    const rows = await db
      .select()
      .from(agentCapabilityObservations)
      .where(
        and(
          eq(agentCapabilityObservations.companyId, companyId),
          eq(agentCapabilityObservations.agentId, agentId),
          eq(agentCapabilityObservations.adapterType, adapterType),
        ),
      )
      .orderBy(desc(agentCapabilityObservations.checkedAt))
      .limit(2);
    const prior = rows.map(toObservation).find((o) => o.id !== fresh.id);
    return prior ?? null;
  }

  return { latestObservation, observationHistory, runManualCheck };
}

export type CapabilityCheckService = ReturnType<typeof capabilityCheckService>;
