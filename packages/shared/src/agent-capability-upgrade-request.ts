import { z } from "zod";
import { agentCapabilityDiffEntrySchema } from "./agent-capability-observation.js";

/** Persistence contract; admission metadata is independent of ordinary issue status. */
export const agentCapabilityUpgradeRequestSchema = z.object({
  id: z.string().uuid(), companyId: z.string().uuid(), observationId: z.string().uuid(),
  issueId: z.string().uuid(), selectedAgentId: z.string().uuid(), idempotencyKey: z.string().min(1),
  diff: z.array(agentCapabilityDiffEntrySchema), requestedByUserId: z.string().nullable(),
  requestedByAgentId: z.string().uuid().nullable(), createdAt: z.string().datetime(),
  admissionState: z.enum(["awaiting_user_confirmation", "admitted"]),
  confirmedAt: z.string().datetime().nullable(), confirmedByUserId: z.string().nullable(),
}).strict().superRefine((value, ctx) => {
  const valid = value.admissionState === "admitted"
    ? value.confirmedAt !== null && value.confirmedByUserId !== null
    : value.confirmedAt === null && value.confirmedByUserId === null;
  if (!valid) ctx.addIssue({ code: "custom", message: "Admission state must match durable user confirmation" });
});
export type AgentCapabilityUpgradeRequest = z.infer<typeof agentCapabilityUpgradeRequestSchema>;

/** Same observation always identifies the same request within its company. */
export function capabilityUpgradeRequestKey(observationId: string): string {
  return `capability-upgrade:${observationId}`;
}
