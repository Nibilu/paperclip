// The session-discard gate.
//
// Invariant: when a run settles with `discardPersistentState`, the run may
// not end until the persisted ACPX session record either no longer exists or
// carries `reset_on_next_ensure`. The next run reads that record to decide
// whether to resume the backend session; a record still pointing at a dead
// backend session deterministically re-fails every later resume
// (`Persistent ACP session … could not be resumed`).
//
// Why the gate exists: acpx 0.12.0 `close({ discardPersistentState: true })`
// calls `closeBackendSession()` BEFORE writing `reset_on_next_ensure`, so for
// any backend without `session/close` (the Hermes gateway advertises
// `{ resume, list, fork }`) the close call throws
// `ACP_BACKEND_UNSUPPORTED_CONTROL`, the reset flag is never persisted, and
// `sessionStore.save()` then writes the record without it. The engine used to
// swallow that close error on this path, so the poisoning was silent.
//
// The gate verifies the persisted outcome after the close attempt and
// remediates by writing the reset flag itself (the exact state acpx would
// have persisted). An unconfirmable record is a hard, reported failure —
// never a silent one.

/** Outcome of verifying (and, when needed, repairing) the persisted record. */
export interface SessionDiscardGateOutcome {
  /** True when the record is gone or carries `reset_on_next_ensure`. */
  readonly confirmed: boolean;
  /** True when the gate itself had to write the missing reset flag. */
  readonly remediated: boolean;
  /** Set when the gate could not load or persist the record. */
  readonly error?: string;
}

/**
 * Minimal structural seam over the ACPX session store
 * (`acpx/runtime` `createRuntimeStore`). Kept closure-shaped so the gate
 * stays decoupled from the acpx record type surface.
 */
export interface SessionDiscardGateStore {
  loadRecord(): Promise<unknown>;
  persistRecord(record: unknown): Promise<void>;
}

function readResetFlag(record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  const acpx = (record as { acpx?: unknown }).acpx;
  if (typeof acpx !== "object" || acpx === null) return false;
  return (acpx as { reset_on_next_ensure?: unknown }).reset_on_next_ensure === true;
}

function withResetFlag(record: unknown): unknown {
  const base = (typeof record === "object" && record !== null ? record : {}) as Record<string, unknown>;
  const acpx = (typeof base.acpx === "object" && base.acpx !== null ? base.acpx : {}) as Record<string, unknown>;
  // Mirror acpx close(): `{ ...record.acpx, reset_on_next_ensure: true }`.
  return { ...base, acpx: { ...acpx, reset_on_next_ensure: true } };
}

export async function confirmDiscardedPersistentRecord(input: {
  store: SessionDiscardGateStore;
}): Promise<SessionDiscardGateOutcome> {
  let record: unknown;
  try {
    record = await input.store.loadRecord();
  } catch (error) {
    return {
      confirmed: false,
      remediated: false,
      error: `load failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // A record that no longer parses or was removed cannot poison a resume.
  if (record === undefined || record === null) return { confirmed: true, remediated: false };
  if (readResetFlag(record)) return { confirmed: true, remediated: false };
  try {
    await input.store.persistRecord(withResetFlag(record));
  } catch (error) {
    return {
      confirmed: false,
      remediated: false,
      error: `persist failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // Verify what actually landed on disk, not what we meant to write.
  let reread: unknown;
  try {
    reread = await input.store.loadRecord();
  } catch (error) {
    return {
      confirmed: false,
      remediated: true,
      error: `re-read failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (reread === undefined || reread === null) {
    // The store dropped the record entirely (e.g. it no longer parses);
    // that also cannot poison a resume.
    return { confirmed: true, remediated: true };
  }
  if (readResetFlag(reread)) return { confirmed: true, remediated: true };
  return {
    confirmed: false,
    remediated: true,
    error: "the persisted record still lacks reset_on_next_ensure after remediation",
  };
}
