import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * Adapter-specific capability observation, written only by an explicit manual
 * capability check (SPEC-implementation 11.2). This is evidence about what a
 * configured adapter endpoint could do at check time. It is not a task status
 * and MUST NOT be joined into task/run status projections.
 */
export const agentCapabilityObservations = pgTable(
  "agent_capability_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    adapterType: text("adapter_type").notNull(),
    /** Redacted endpoint identity (no credentials, no raw authorization headers). */
    endpointLabel: text("endpoint_label").notNull(),
    /** Capability document revision; "unversioned" when the endpoint omits one. */
    revision: text("revision").notNull().default("unversioned"),
    /** Gateway protocol version, e.g. from GET /health version fallback. */
    protocolVersion: text("protocol_version"),
    /** Normalized state from SPEC 11.2 capability states vocabulary. */
    state: text("state").notNull(),
    /** Per-operation availability: create/status/events/stop/approval/idempotency. */
    operations: jsonb("operations").$type<Record<string, unknown>>().notNull().default({}),
    /** Structured error when state is not available: code/stage/nextAction. */
    error: jsonb("error").$type<Record<string, unknown>>(),
    /** Raw capability document, secrets redacted. Null when unavailable. */
    document: jsonb("document").$type<Record<string, unknown>>(),
    /** Features observed outside the Paperclip operation vocabulary. */
    observedExtras: jsonb("observed_extras").$type<Record<string, unknown>>(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    freshnessDeadline: timestamp("freshness_deadline", { withTimezone: true }),
    requestedByUserId: text("requested_by_user_id"),
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentCheckedIdx: index("agent_capability_observations_company_agent_checked_idx").on(
      table.companyId,
      table.agentId,
      table.checkedAt,
    ),
    agentCheckedIdx: index("agent_capability_observations_agent_checked_idx").on(table.agentId, table.checkedAt),
    /** One in-flight observation per agent/adapter; latest row wins for reads. */
    agentAdapterCheckedIdx: uniqueIndex("agent_capability_observations_agent_adapter_checked_uq").on(
      table.agentId,
      table.adapterType,
      table.checkedAt,
    ),
  }),
);
