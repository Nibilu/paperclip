import { heartbeatRuns } from "@pilibalaai/db";
import { sql } from "drizzle-orm";

const recoveryResultKeys = [
  "errorFamily", "workspaceValidation", "configurationIncomplete",
  "cancelledByActorType", "retryNotBefore", "transientRetryNotBefore",
  "providerQuotaRetryNotBefore", "finalizationReasonCode",
  // AMB-250: the shared acpx-engine stamps its turn-completion signal on
  // every adapter's acp lane into these keys. Recovery must be able to see
  // the completion signal on succeeded runs — without them the disposition
  // judgment cannot consume it (AMB-230). Both are tiny strings, so the
  // projection stays well under the bounded receipt size.
  "status", "mode",
] as const;

export const recoveryRunResultColumn = sql<Record<string, unknown> | null>`
  case
    when ${heartbeatRuns.resultJson} is null then null
    when ${heartbeatRuns.errorCode} in ('adapter_failed', 'provider_quota', 'configuration_incomplete')
      then ${heartbeatRuns.resultJson}
    else (
      select coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
      from jsonb_each(case when jsonb_typeof(${heartbeatRuns.resultJson}) = 'object'
        then ${heartbeatRuns.resultJson} else '{}'::jsonb end) as field(key, value)
      where field.key in (${sql.join(recoveryResultKeys.map(key => sql`${key}`), sql`, `)})
    )
  end
`;

/** ACP session modes the shared acpx-engine stamps into `resultJson.mode`. */
const acpRunModes = new Set(["persistent", "oneshot"]);

/**
 * AMB-250: the shared acpx-engine records a turn-completion signal on every
 * adapter's acp lane as `resultJson.status === "completed"` together with the
 * ACP session `mode` (the terminal result always carries `mode`, while
 * `stopReason` is optional in the acpx runtime contract and may be absent on
 * a valid completion, so it is deliberately not required here).
 *
 * The judgment is signal-shaped on purpose — no adapterType/engine
 * allow-list: any succeeded run carrying this exact shape counts. The `mode`
 * marker is what keeps the one known conflicting shape out: the hermes
 * gateway lane also writes a bare `status` ("completed" on success) but
 * never an acp `mode`, so those runs keep the pre-existing disposition-repair
 * behavior.
 */
export function hasAcpCompletionSignal(resultJson: unknown): boolean {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) return false;
  const result = resultJson as Record<string, unknown>;
  return result.status === "completed" && acpRunModes.has(String(result.mode));
}
