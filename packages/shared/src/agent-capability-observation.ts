import { z } from "zod";

/**
 * Adapter capability observation contract (SPEC-implementation 11.2).
 * Adapter-specific evidence about what a configured endpoint could do at check
 * time. Never a task status; never a Paperclip run status.
 */

export const AGENT_CAPABILITY_OBSERVATION_STATES = [
  "unknown",
  "checking",
  "available",
  "partially_supported",
  "unsupported",
  "stale",
  "unreachable",
  "authentication_failed",
  "protocol_incompatible",
  "malformed_response",
] as const;

export const agentCapabilityObservationStateSchema = z.enum(AGENT_CAPABILITY_OBSERVATION_STATES);
export type AgentCapabilityObservationState = (typeof AGENT_CAPABILITY_OBSERVATION_STATES)[number];

/** Operation vocabulary Paperclip admission cares about. */
export const AGENT_CAPABILITY_OPERATIONS = [
  "create",
  "status",
  "events",
  "stop",
  "approval",
  "idempotency",
] as const;

export const agentCapabilityOperationStateSchema = z.object({
  supported: z.boolean(),
  /** Endpoint identity from the capability document, when present. */
  endpoint: z.string().optional(),
  detail: z.string().optional(),
});

export const agentCapabilityObservationErrorSchema = z
  .object({
    code: z.string().min(1),
    stage: z.string().min(1),
    message: z.string().optional(),
    nextAction: z.string().optional(),
  })
  .strict();

export const agentCapabilityObservationSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    agentId: z.string().uuid(),
    adapterType: z.string().min(1),
    endpointLabel: z.string().min(1),
    revision: z.string().min(1).default("unversioned"),
    protocolVersion: z.string().optional(),
    state: agentCapabilityObservationStateSchema,
    operations: z.record(z.string(), agentCapabilityOperationStateSchema),
    error: agentCapabilityObservationErrorSchema.optional(),
    observedExtras: z.record(z.string(), z.unknown()).optional(),
    checkedAt: z.string(),
    freshnessDeadline: z.string().optional(),
  })
  .strict();

export type AgentCapabilityObservation = z.infer<typeof agentCapabilityObservationSchema>;
export type AgentCapabilityOperationState = z.infer<typeof agentCapabilityOperationStateSchema>;
export type AgentCapabilityObservationError = z.infer<typeof agentCapabilityObservationErrorSchema>;

/** Result of comparing a fresh observation against the previous stored one. */
export const AGENT_CAPABILITY_DIFF_KINDS = ["added", "removed", "changed", "unchanged"] as const;
export const agentCapabilityDiffEntrySchema = z
  .object({
    kind: z.enum(AGENT_CAPABILITY_DIFF_KINDS),
    scope: z.enum(["operation", "endpoint", "revision", "protocol"]),
    key: z.string().min(1),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    remediation: z.string().optional(),
  })
  .strict();
export type AgentCapabilityDiffEntry = z.infer<typeof agentCapabilityDiffEntrySchema>;
export type AgentCapabilityDiffKind = (typeof AGENT_CAPABILITY_DIFF_KINDS)[number];

/** A capability diff requires development work when anything was added/removed/changed. */
export function capabilityDiffRequiresUpgradeTask(diff: AgentCapabilityDiffEntry[]): boolean {
  return diff.some((entry) => entry.kind !== "unchanged");
}
