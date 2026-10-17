import { z } from "zod";

/**
 * HG-A5 (SPEC-implementation 11.2): submission of an adapter capability-gap
 * upgrade task. The upgrade task is an ordinary Paperclip task; the capability
 * provenance below is immutable creation metadata, and the pre-dispatch user
 * confirmation gate (HG-A6) is admission metadata, not a task status.
 */

export const createCapabilityUpgradeTaskSchema = z
  .object({
    agentId: z.string().guid(),
    /** Agent selected to perform the upgrade work; must be assignable in the company. */
    upgradeAgentId: z.string().guid(),
    /** The manual-check observation the gap was detected in. */
    observationId: z.string().guid(),
  })
  .strict();
export type CreateCapabilityUpgradeTaskInput = z.infer<typeof createCapabilityUpgradeTaskSchema>;

/** Immutable provenance embedded in the created task's description metadata block. */
export type CapabilityUpgradeTaskProvenance = {
  /** The manual-check observation whose diff spawned this upgrade task (A7 traceability). */
  observationId: string;
  sourceAgentId: string;
  sourceAdapterType: string;
  endpointLabel: string;
  capabilityRevision: string | null;
  protocolVersion: string | null;
  diff: Array<{
    kind: string;
    scope: string;
    key: string;
    before?: unknown;
    after?: unknown;
    remediation?: string;
  }>;
  requestedByUserId: string | null;
};

export const CAPABILITY_UPGRADE_ADMISSION_GATE_REASON = "capability_upgrade_awaiting_user_confirmation";
