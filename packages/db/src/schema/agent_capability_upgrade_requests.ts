import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AgentCapabilityDiffEntry } from "@pilibalaai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { agentCapabilityObservations } from "./agent_capability_observations.js";

/** Durable provenance and admission metadata. The linked issue uses ordinary task statuses.
 * One request per observation: retries, including concurrent retries, reuse its issue.
 * Creation of issue, request and activity must share one transaction.
 */
export const agentCapabilityUpgradeRequests = pgTable("agent_capability_upgrade_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  observationId: uuid("observation_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  selectedAgentId: uuid("selected_agent_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  diff: jsonb("diff").$type<AgentCapabilityDiffEntry[]>().notNull(),
  requestedByUserId: text("requested_by_user_id"),
  requestedByAgentId: uuid("requested_by_agent_id"),
  admissionState: text("admission_state").notNull().default("awaiting_user_confirmation"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedByUserId: text("confirmed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  observationFk: foreignKey({ columns: [t.companyId, t.observationId], foreignColumns: [agentCapabilityObservations.companyId, agentCapabilityObservations.id], name: "capability_upgrade_observation_fk" }),
  issueFk: foreignKey({ columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id], name: "capability_upgrade_issue_fk" }),
  agentFk: foreignKey({ columns: [t.companyId, t.selectedAgentId], foreignColumns: [agents.companyId, agents.id], name: "capability_upgrade_agent_fk" }),
  requesterFk: foreignKey({ columns: [t.companyId, t.requestedByAgentId], foreignColumns: [agents.companyId, agents.id], name: "capability_upgrade_requester_fk" }),
  keyUq: uniqueIndex("capability_upgrade_key_uq").on(t.companyId, t.idempotencyKey),
  observationUq: uniqueIndex("capability_upgrade_observation_uq").on(t.companyId, t.observationId),
  issueUq: uniqueIndex("capability_upgrade_issue_uq").on(t.companyId, t.issueId),
  admissionCheck: check("capability_upgrade_admission_check", sql`(${t.admissionState} = 'awaiting_user_confirmation' AND ${t.confirmedAt} IS NULL AND ${t.confirmedByUserId} IS NULL) OR (${t.admissionState} = 'admitted' AND ${t.confirmedAt} IS NOT NULL AND ${t.confirmedByUserId} IS NOT NULL)`),
}));
