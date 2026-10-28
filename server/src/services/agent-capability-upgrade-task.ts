import { and, eq } from "drizzle-orm";
import { agentCapabilityObservations, agentCapabilityUpgradeRequests, agents, type Db } from "@pilibalaai/db";
import {
  CAPABILITY_UPGRADE_ADMISSION_GATE_REASON,
  capabilityUpgradeRequestKey,
  type AgentCapabilityDiffEntry,
  type CapabilityUpgradeTaskProvenance,
  type CreateCapabilityUpgradeTaskInput,
} from "@pilibalaai/shared";

import { issues } from "@pilibalaai/db";
import { sql } from "drizzle-orm";

import { logActivity } from "./activity-log.js";

/**
 * HG-A5/A6 (SPEC-implementation 11.2): capability-gap upgrade tasks.
 *
 * Submission creates an ordinary `todo` task assigned to the user-selected
 * agent, carrying immutable capability provenance in a durable request row. The task
 * waits behind an explicit user-confirmation admission gate — control-plane
 * metadata on the issue, never a new task status. Until confirmation the task
 * MUST NOT be enqueued, woken, or dispatched; confirmation releases it to the
 * normal unified scheduler by clearing the gate.
 *
 * No special bypass lane: the created task still obeys normal assignment,
 * workspace, approval, and budget rules. It cannot clear a reconciliation
 * hold, replay an uncertain remote run, or mutate unrelated tasks.
 */

export type CapabilityUpgradeTaskCreated = {
  issueId: string;
  identifier: string | null;
  status: string;
  admissionGate: {
    reason: string;
    confirmedAt: string | null;
  };
};

function provenanceMarkdown(provenance: CapabilityUpgradeTaskProvenance): string {
  const lines = [
    "Implement and verify the adapter capability changes below, then request a fresh manual capability check.",
    "",
    "<!-- capability-upgrade-provenance",
    JSON.stringify(provenance),
    "-->",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Source agent | \`${provenance.sourceAgentId}\` |`,
    `| Adapter | \`${provenance.sourceAdapterType}\` |`,
    `| Endpoint | \`${provenance.endpointLabel}\` |`,
    `| Capability revision | \`${provenance.capabilityRevision ?? "unversioned"}\` |`,
    `| Protocol version | \`${provenance.protocolVersion ?? "unknown"}\` |`,
    "",
    "### Detected capability diff",
    "",
  ];
  for (const entry of provenance.diff) {
    const change =
      entry.kind === "changed"
        ? `${JSON.stringify(entry.before ?? null)} -> ${JSON.stringify(entry.after ?? null)}`
        : JSON.stringify(entry.after ?? null);
    lines.push(`- **${entry.kind}** ${entry.scope} \`${entry.key}\`: ${change}${entry.remediation ? ` — ${entry.remediation}` : ""}`);
  }
  lines.push(
    "",
    "After the upgrade work, a fresh manual capability check must succeed before the capability is treated as available.",
  );
  return lines.join("\n");
}

function admissionGatePolicy(): Record<string, unknown> {
  return {
    admissionGate: {
      reason: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON,
      confirmedAt: null as string | null,
    },
  };
}

export function capabilityUpgradeTaskService(db: Db) {
  /**
   * HG-A5: submit the upgrade task. Fails closed when the latest manual check
   * for the agent did not detect a concrete gap, when the observation is not
   * the agent's latest, or when the selected upgrade agent is not assignable.
   */
  async function submitUpgradeTask(
    companyId: string,
    input: CreateCapabilityUpgradeTaskInput & {
      requestedByUserId: string | null;
      requestedByAgentId?: string | null;
      createIssue: (data: Record<string, unknown>, tx: Db) => Promise<{
        id: string;
        identifier: string | null;
      }>;
    },
  ): Promise<CapabilityUpgradeTaskCreated> {
    return db.transaction(async (transaction) => {
      const db = transaction as unknown as Db;
      const key = capabilityUpgradeRequestKey(input.observationId);
      // Database lock, not an in-process map: serialize across workers and restarts.
      await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId + ":" + key}, 0))`);
      const [existing] = await db.select().from(agentCapabilityUpgradeRequests).where(and(
        eq(agentCapabilityUpgradeRequests.companyId, companyId),
        eq(agentCapabilityUpgradeRequests.idempotencyKey, key),
      )).limit(1);
      if (existing) {
        const [source] = await db.select().from(agentCapabilityObservations).where(and(
          eq(agentCapabilityObservations.companyId, companyId), eq(agentCapabilityObservations.id, existing.observationId),
        )).limit(1);
        if (source?.agentId !== input.agentId || existing.selectedAgentId !== input.upgradeAgentId) {
          throw Object.assign(new Error("Retry conflicts with the original upgrade request"), { code: "upgrade_request_conflict" });
        }
        const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, existing.issueId))).limit(1);
        return { issueId: existing.issueId, identifier: issue?.identifier ?? null, status: issue?.status ?? "todo",
          admissionGate: { reason: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON, confirmedAt: existing.confirmedAt?.toISOString() ?? null } };
      }
      const [sourceAgent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.companyId, companyId)))
        .limit(1);
      if (!sourceAgent) throw Object.assign(new Error("Agent not found"), { code: "agent_not_found" });

      const [upgradeAgent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, input.upgradeAgentId), eq(agents.companyId, companyId)))
        .limit(1);
      if (!upgradeAgent || ["terminated", "paused", "pending_approval"].includes(upgradeAgent.status)) {
        throw Object.assign(new Error("Upgrade agent not found in this company"), {
          code: "upgrade_agent_not_found",
        });
      }

      const [observation] = await db
        .select()
        .from(agentCapabilityObservations)
        .where(
          and(
            eq(agentCapabilityObservations.id, input.observationId),
            eq(agentCapabilityObservations.companyId, companyId),
            eq(agentCapabilityObservations.agentId, input.agentId),
          ),
        )
        .limit(1);
      if (!observation) {
        throw Object.assign(new Error("Capability observation not found"), {
          code: "observation_not_found",
        });
      }

      // The gap must be concrete and current: recompute the diff server-side from
      // the latest TWO stored observations (diffs are derived at check time and
      // are not client-trusted input).
      const checkService = await import("./agent-capability-check.js");
      const history = await db
        .select()
        .from(agentCapabilityObservations)
        .where(
          and(
            eq(agentCapabilityObservations.companyId, companyId),
            eq(agentCapabilityObservations.agentId, input.agentId),
            eq(agentCapabilityObservations.adapterType, observation.adapterType),
          ),
        )
        .orderBy(agentCapabilityObservations.checkedAt)
        .then((rows) => rows.map(checkService.toObservation));
      const latest = history[history.length - 1] ?? null;
      if (latest?.id !== observation.id) {
        throw Object.assign(
          new Error("Capability observation is not the latest check for this agent"),
          { code: "observation_stale" },
        );
      }
      const previous = history.length >= 2 ? history[history.length - 2] : null;
      const diff = checkService.diffObservations(previous, latest).filter((entry) => entry.kind !== "unchanged");

      const provenance: CapabilityUpgradeTaskProvenance = {
        observationId: observation.id,
        sourceAgentId: sourceAgent.id,
        sourceAdapterType: sourceAgent.adapterType ?? "hermes_gateway",
        endpointLabel: observation.endpointLabel ?? "unknown",
        capabilityRevision: observation.revision ?? null,
        protocolVersion: observation.protocolVersion ?? null,
        diff,
        requestedByUserId: input.requestedByUserId,
      };
      if (provenance.diff.length === 0) {
        throw Object.assign(new Error("No capability gap detected in the latest check"), {
          code: "no_capability_gap",
        });
      }

      const issue = await input.createIssue({
        companyId,
        title: `Adapter capability upgrade: ${provenance.endpointLabel} (${provenance.capabilityRevision ?? "unversioned"})`,
        description: provenanceMarkdown(provenance),
        status: "todo",
        assigneeAgentId: upgradeAgent.id,
        originKind: "manual",
        executionPolicy: admissionGatePolicy(),
        createdByUserId: input.requestedByUserId,
      } as Record<string, unknown>, db);

      await db.insert(agentCapabilityUpgradeRequests).values({
        companyId, observationId: observation.id, issueId: issue.id, selectedAgentId: upgradeAgent.id,
        idempotencyKey: key, diff, requestedByUserId: input.requestedByUserId, requestedByAgentId: input.requestedByAgentId ?? null,
      });

      await logActivity(db, {
        companyId,
        actorType: input.requestedByAgentId ? "agent" : "user",
        actorId: input.requestedByAgentId ?? input.requestedByUserId ?? "system",
        action: "agent_capability_upgrade_task_created",
        entityType: "issue",
        entityId: issue.id,
        agentId: upgradeAgent.id,
        details: {
          sourceAgentId: sourceAgent.id,
          observationId: observation.id,
          upgradeAgentId: upgradeAgent.id,
          capabilityRevision: provenance.capabilityRevision,
          diffKinds: provenance.diff.map((entry) => `${entry.kind}:${entry.scope}:${entry.key}`),
          admissionGate: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON,
        },
      });

      return {
        issueId: issue.id,
        identifier: issue.identifier ?? null,
        status: "todo",
        admissionGate: { reason: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON, confirmedAt: null },
      };
    });
  }

  /**
   * HG-A6: explicit user confirmation. Idempotent; authorized callers only.
   * Clears the admission gate so the task enters normal unified scheduling.
   */
  async function confirmUpgradeTask(
    companyId: string,
    issueId: string,
    options: { confirmedByUserId: string | null },
  ): Promise<{ confirmed: boolean; confirmedAt: string }> {
    if (!options.confirmedByUserId) throw Object.assign(new Error("User confirmation required"), { code: "user_confirmation_required" });
    const confirmedByUserId = options.confirmedByUserId;
    return db.transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      const confirmedAt = new Date();
      const [request] = await tx.select().from(agentCapabilityUpgradeRequests).where(and(
        eq(agentCapabilityUpgradeRequests.companyId, companyId), eq(agentCapabilityUpgradeRequests.issueId, issueId),
      )).for("update");
      if (!request) throw Object.assign(new Error("Upgrade request not found"), { code: "task_not_found" });
      if (request.confirmedAt) return { confirmed: false, confirmedAt: request.confirmedAt.toISOString() };
      const [current] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("update");
      if (current?.status !== "todo") throw Object.assign(new Error("Task is not awaiting confirmation"), { code: "task_not_gated" });
      await tx.update(agentCapabilityUpgradeRequests).set({ admissionState: "admitted", confirmedAt, confirmedByUserId }).where(eq(agentCapabilityUpgradeRequests.id, request.id));
      await tx.update(issues).set({
        executionPolicy: sql`jsonb_set(coalesce(${issues.executionPolicy}, '{}'::jsonb), '{admissionGate,confirmedAt}', to_jsonb(${confirmedAt.toISOString()}::text), true)`, updatedAt: confirmedAt,
      }).where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));
      await logActivity(tx, { companyId, actorType: "user", actorId: confirmedByUserId,
        action: "agent_capability_upgrade_task_confirmed", entityType: "issue", entityId: issueId,
        details: { requestId: request.id, confirmedAt: confirmedAt.toISOString() } });
      return { confirmed: true, confirmedAt: confirmedAt.toISOString() };
    });
  }


  /**
   * HG-A7: traceability read model. Lists this agent's upgrade tasks with the
   * observation id they were created from and their current status, so the UI
   * can show "created from check X" and whether a fresh check has since
   * verified the upgrade (revision moved past provenance.capabilityRevision).
   */
  async function listUpgradeTasksForAgent(companyId: string, sourceAgentId: string) {
    const rows = await db.select({
      id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status,
      description: issues.description, executionPolicy: issues.executionPolicy,
      createdAt: issues.createdAt, completedAt: issues.completedAt,
      request: agentCapabilityUpgradeRequests, observation: agentCapabilityObservations,
    }).from(agentCapabilityUpgradeRequests)
      .innerJoin(issues, and(eq(issues.id, agentCapabilityUpgradeRequests.issueId), eq(issues.companyId, companyId)))
      .innerJoin(agentCapabilityObservations, and(eq(agentCapabilityObservations.id, agentCapabilityUpgradeRequests.observationId), eq(agentCapabilityObservations.companyId, companyId)))
      .where(and(eq(agentCapabilityUpgradeRequests.companyId, companyId), eq(agentCapabilityObservations.agentId, sourceAgentId)))
      .orderBy(issues.createdAt);
    const tasks = rows.map((row) => {
      const provenance: CapabilityUpgradeTaskProvenance = {
        observationId: row.observation.id, sourceAgentId: row.observation.agentId,
        sourceAdapterType: row.observation.adapterType, endpointLabel: row.observation.endpointLabel,
        capabilityRevision: row.observation.revision, protocolVersion: row.observation.protocolVersion,
        diff: row.request.diff, requestedByUserId: row.request.requestedByUserId,
      };
      return {
        issueId: row.id,
        identifier: row.identifier,
        title: row.title,
        status: row.status,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        admissionGateConfirmedAt: row.request.confirmedAt?.toISOString() ?? null,
        provenance,
      };
    });
    return tasks.filter((task) => task.provenance?.sourceAgentId === sourceAgentId);
  }

  return { submitUpgradeTask, confirmUpgradeTask, listUpgradeTasksForAgent };
}
