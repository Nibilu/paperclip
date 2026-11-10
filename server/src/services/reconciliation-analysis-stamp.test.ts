import { describe, expect, it, vi } from "vitest";

// Direct assertions for stampL2HoldsMissingAnalysis (reached through the
// exported deliverReconciliationAnalyses sweep): a stranded_assigned_issue hold
// whose latest failure is the TRANSIENT session-lifecycle resume class
// (acpx_session_resume_failed / "Persistent ACP session … could not be
// resumed", ladderHint L0) must NOT be stamped with a reconciliationAnalysis —
// L0 stays on the bounded-retry ladder and out of the diagnosis flow. Only
// genuine L2 classifications (e.g. acpx_session_config_failed →
// runtime.adapter_boot_failure) are stamped. Before AMB-193 this behavior was
// only implied by the L2 category filter; these tests pin it directly.

vi.mock("./activity-log.js", () => ({
  persistActivity: vi.fn(async () => undefined),
}));

import { deliverReconciliationAnalyses } from "./reconciliation-analysis.js";

type RecoveryRow = {
  id: string;
  companyId: string;
  sourceIssueId: string;
  kind: string;
  status: string;
  evidence: Record<string, unknown>;
};

function strandedRow(input: { id: string; evidence: Record<string, unknown> }): RecoveryRow {
  return {
    id: input.id,
    companyId: "c1",
    sourceIssueId: "issue-1",
    kind: "stranded_assigned_issue",
    status: "active",
    evidence: input.evidence,
  };
}

function makeDb(candidates: RecoveryRow[]) {
  const updates: { set: Record<string, unknown>; whereLabel: string }[] = [];
  // The sweep runs two selects: the first is the L2 stamp candidate read, the
  // second (and later) reads drive the dispatch loop — return candidates only
  // for the stamp read so dispatch never sees the fake rows.
  let selectCall = 0;
  const db = {
    select: vi.fn(() => {
      const rowsForThisCall = selectCall++ === 0 ? candidates : [];
      const chain: {
        from: () => unknown;
        where: () => unknown;
        limit: () => RecoveryRow[];
        then: (resolve: (rows: RecoveryRow[]) => unknown) => unknown;
      } = {
        from: () => chain,
        where: () => chain,
        limit: () => rowsForThisCall,
        then: (resolve) => Promise.resolve(rowsForThisCall).then(resolve),
      };
      return chain;
    }),
    update: vi.fn((_table: unknown) => {
      const updateChain: {
        set: (setArg: Record<string, unknown>) => {
          where: (whereArg: unknown) => {
            returning: () => Promise<unknown[]>;
          };
        };
      } = {
        set: (setArg: Record<string, unknown>) => ({
          where: (whereArg: unknown) => {
            updates.push({ set: setArg, whereLabel: String(whereArg) });
            return {
              returning: () => Promise.resolve([]),
            };
          },
        }),
      };
      return updateChain;
    }),
  };
  return { db: db as never, updates };
}

const wake = ({} as never);

/** Extract readable text from Drizzle SQL/param objects without JSON.stringify (they hold circular PgTable refs). */
function safeText(v: unknown, seen = new WeakSet<object>(), depth = 0): string {
  if (v == null) return "";
  if (typeof v !== "object") return typeof v === "string" ? v : String(v);
  if (seen.has(v) || depth > 8) return "";
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => safeText(x, seen, depth + 1)).join("");
  let out = "";
  for (const val of Object.values(v)) out += safeText(val, seen, depth + 1);
  return out;
}

describe("stampL2HoldsMissingAnalysis (AMB-193 S2 direct assertions)", () => {
  it("does not stamp reconciliationAnalysis for acpx_session_resume_failed (L0 stays out of the diagnosis flow)", async () => {
    const { db, updates } = makeDb([
      strandedRow({
        id: "resume-failed-hold",
        evidence: {
          latestRunErrorCode: "acpx_session_resume_failed",
          latestRunError: "Persistent ACP session local-1158443d could not be resumed: not_found",
        },
      }),
    ]);
    await deliverReconciliationAnalyses(db, wake);
    expect(updates).toEqual([]);
  });

  it("does not stamp the message-form resume signal even without an errorCode", async () => {
    const { db, updates } = makeDb([
      strandedRow({
        id: "resume-failed-message-hold",
        evidence: {
          latestRunError: "Persistent ACP session local-abc123 could not be resumed: Internal error",
        },
      }),
    ]);
    await deliverReconciliationAnalyses(db, wake);
    expect(updates).toEqual([]);
  });

  it("stamps a genuine L2 hold (acpx_session_config_failed) as the control group", async () => {
    const { db, updates } = makeDb([
      strandedRow({
        id: "config-failed-hold",
        evidence: {
          latestRunErrorCode: "acpx_session_config_failed",
          latestRunError:
            "ACP session pilibala:c1:04a:fb does not advertise config option 'model'. Supported config options: none.",
        },
      }),
    ]);
    await deliverReconciliationAnalyses(db, wake);
    expect(updates.length).toBe(2);
    const stamp = updates.find(u => safeText(u.set).includes("reconciliationAnalysis"));
    expect(stamp).toBeTruthy();
    expect(safeText(stamp?.set)).toContain("ladder_l2_selfheal");
    expect(safeText(stamp?.set)).toContain("\"pending\"");
  });

  it("keeps the L0 resume class outside the L2 stamp categories and the creation-side preset condition", async () => {
    // Escalation semantics: a resume_failed hold escalates as a blocked board
    // hold with structured operator notices (creation-side evidence has NO
    // reconciliationAnalysis preset; the stamp sweep above must not add one).
    // Both sides share the same L2 category set — pin the set membership here
    // so a future classifier drift cannot silently promote the L0 class into
    // the diagnosis flow.
    const { classifyRunFailure } = await import("./recovery/error-classification.js");
    const resume = classifyRunFailure({
      adapterType: "hermes_local",
      errorCode: "acpx_session_resume_failed",
      errorMessage: "Persistent ACP session local-1158443d could not be resumed: not_found",
    });
    const l2Categories = ["session_binding.resume_policy_refusal", "runtime.adapter_boot_failure"];
    expect(l2Categories).not.toContain(resume.category);
    expect(resume.retryPolicy).toBe("bounded");
    expect(resume.ladderHint).toBe("L0");
  });
});
