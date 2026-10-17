import { and, eq } from "drizzle-orm";
import { agentCapabilityObservations, agents, type Db } from "@paperclipai/db";
import {
  CAPABILITY_UPGRADE_ADMISSION_GATE_REASON,
  type AgentCapabilityDiffEntry,
  type CapabilityUpgradeTaskProvenance,
  type CreateCapabilityUpgradeTaskInput,
} from "@paperclipai/shared";

import { issues } from "@paperclipai/db";
import { sql } from "drizzle-orm";

import { logActivity } from "./activity-log.js";

/**
 * HG-A5/A6 (SPEC-implementation 11.2): capability-gap upgrade tasks.
 *
 * Submission creates an ordinary `todo` task assigned to the user-selected
 * agent, carrying immutable capability provenance in its description. The task
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
  status: "todo";
  admissionGate: {
    reason: string;
    confirmedAt: string | null;
  };
};

type ObservationRow = typeof agentCapabilityObservations.$inferSelect;

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
      createIssue: (data: Record<string, unknown>) => Promise<{
        id: string;
        identifier: string | null;
      }>;
    },
  ): Promise<CapabilityUpgradeTaskCreated> {
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
    if (!upgradeAgent) {
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
    } as Record<string, unknown>);

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: input.requestedByUserId ?? "system",
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
    const confirmedAt = new Date().toISOString();

    const [current] = await db
      .select({ id: issues.id, status: issues.status, executionPolicy: issues.executionPolicy })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .limit(1);
    if (!current) throw Object.assign(new Error("Task not found"), { code: "task_not_found" });

    const policy = (current.executionPolicy ?? {}) as Record<string, unknown>;
    const gate = policy.admissionGate as { reason?: string; confirmedAt?: string | null } | undefined;
    if (!gate || gate.reason !== CAPABILITY_UPGRADE_ADMISSION_GATE_REASON) {
      // Idempotent no-op: already admitted (or never gated).
      return { confirmed: false, confirmedAt };
    }
    if (gate.confirmedAt) {
      return { confirmed: false, confirmedAt: gate.confirmedAt };
    }
    if (current.status !== "todo") {
      throw Object.assign(new Error("Task is not awaiting confirmation"), { code: "task_not_gated" });
    }

    await db
      .update(issues)
      .set({
        executionPolicy: sql`jsonb_set(coalesce(${issues.executionPolicy}, '{}'::jsonb), '{admissionGate,confirmedAt}', to_jsonb(${confirmedAt}::text), true)`,
        updatedAt: new Date(),
      })
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: options.confirmedByUserId ?? "system",
      action: "agent_capability_upgrade_task_confirmed",
      entityType: "issue",
      entityId: issueId,
      details: { admissionGate: CAPABILITY_UPGRADE_ADMISSION_GATE_REASON, confirmedAt },
    });

    return { confirmed: true, confirmedAt };
  }


  /**
   * HG-A7: traceability read model. Lists this agent's upgrade tasks with the
   * observation id they were created from and their current status, so the UI
   * can show "created from check X" and whether a fresh check has since
   * verified the upgrade (revision moved past provenance.capabilityRevision).
   */
  async function listUpgradeTasksForAgent(companyId: string, sourceAgentId: string) {
    const { ilike } = await import("drizzle-orm");
    const marker = `%"observationId"%`; // provenance JSON presence
    const rows = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        description: issues.description,
        executionPolicy: issues.executionPolicy,
        createdAt: issues.createdAt,
        completedAt: issues.completedAt,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeAgentId, sourceAgentId),
          ilike(issues.title, "Adapter capability upgrade:%"),
        ),
      )
      .orderBy(issues.createdAt)
      .then((rows) => rows);
    const tasks = rows.map((row) => {
      const match = /<!-- capability-upgrade-provenance\n(.*?)\n-->/.exec(row.description ?? "");
      let provenance: CapabilityUpgradeTaskProvenance | null = null;
      if (match) {
        try {
          provenance = JSON.parse(match[1]) as CapabilityUpgradeTaskProvenance;
        } catch {
          provenance = null;
        }
      }
      const policy = (row.executionPolicy ?? {}) as Record<string, unknown>;
      const gate = policy.admissionGate as { reason?: string; confirmedAt?: string | null } | undefined;
      return {
        issueId: row.id,
        identifier: row.identifier,
        title: row.title,
        status: row.status,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        admissionGateConfirmedAt: gate?.confirmedAt ?? null,
        provenance,
      };
    });
    return tasks.filter((task) => task.provenance?.sourceAgentId === sourceAgentId);
  }

  return { submitUpgradeTask, confirmUpgradeTask, listUpgradeTasksForAgent };
}
