import { describe, expect, it } from "vitest";
import {
  confirmDiscardedPersistentRecord,
  type SessionDiscardGateStore,
} from "./session-discard-gate.js";

function memoryStore(
  seed: unknown,
  options: { failSave?: boolean } = {},
): { store: SessionDiscardGateStore; saved: unknown[] } {
  let record = seed;
  const saved: unknown[] = [];
  return {
    saved,
    store: {
      loadRecord: async () => record,
      persistRecord: async (next) => {
        if (options.failSave) throw new Error("disk unwritable");
        saved.push(next);
        record = next;
      },
    },
  };
}

describe("confirmDiscardedPersistentRecord", () => {
  it("confirms when the persisted record is already gone", async () => {
    const { store } = memoryStore(undefined);
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome).toEqual({ confirmed: true, remediated: false });
  });

  it("confirms without remediating when reset_on_next_ensure is already persisted", async () => {
    const { store } = memoryStore({ acpxRecordId: "r1", acpx: { reset_on_next_ensure: true } });
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome).toEqual({ confirmed: true, remediated: false });
  });

  it("remediates the acpx 0.12.0 close-ordering hole and verifies the flag landed", async () => {
    // close() threw before writing the flag; the record survived WITHOUT it.
    const { store, saved } = memoryStore({ acpxRecordId: "r1", acpx: { other: 1 } });
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome).toEqual({ confirmed: true, remediated: true });
    expect(saved).toHaveLength(1);
  });

  it("also remediates a record with no acpx block at all", async () => {
    const { store } = memoryStore({ acpxRecordId: "r1" });
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome).toEqual({ confirmed: true, remediated: true });
  });

  it("reports unconfirmed when the remediation cannot persist", async () => {
    const { store } = memoryStore({ acpxRecordId: "r1" }, { failSave: true });
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome.confirmed).toBe(false);
    expect(outcome.error).toContain("persist failed");
  });

  it("reports unconfirmed when the store keeps dropping the reset flag", async () => {
    let saves = 0;
    const store: SessionDiscardGateStore = {
      loadRecord: async () => ({ acpxRecordId: "r1", acpx: saves > 0 ? {} : undefined }),
      persistRecord: async () => {
        saves += 1;
      },
    };
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome.confirmed).toBe(false);
    expect(outcome.remediated).toBe(true);
    expect(outcome.error).toContain("still lacks reset_on_next_ensure");
  });

  it("treats a record that stops parsing (gone after remediation) as neutralized", async () => {
    let loads = 0;
    const store: SessionDiscardGateStore = {
      loadRecord: async () => (loads++ === 0 ? { acpxRecordId: "r1" } : undefined),
      persistRecord: async () => {},
    };
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome).toEqual({ confirmed: true, remediated: true });
  });

  it("reports unconfirmed when loading the record fails", async () => {
    const store: SessionDiscardGateStore = {
      loadRecord: async () => {
        throw new Error("store unreadable");
      },
      persistRecord: async () => {},
    };
    const outcome = await confirmDiscardedPersistentRecord({ store });
    expect(outcome.confirmed).toBe(false);
    expect(outcome.error).toContain("load failed");
  });
});
