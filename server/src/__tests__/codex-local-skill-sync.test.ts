import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCodexSkills,
  syncCodexSkills,
} from "@pilibalaai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("codex local skill sync", () => {
  const pilibalaKey = "pilibalaai/pilibala/pilibala";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("defaults the operational Pilibala skill for workspace injection on the next run", async () => {
    const codexHome = await makeTempDir("pilibala-codex-skill-sync-");
    cleanupDirs.add(codexHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
      },
    } as const;

    const before = await listCodexSkills(ctx);
    expect(before.mode).toBe("ephemeral");
    expect(before.desiredSkills).toContain(pilibalaKey);
    expect(before.entries.find((entry) => entry.key === pilibalaKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === pilibalaKey)?.detail).toContain("CODEX_HOME/skills/");
  });

  it("does not apply the legacy operational skill default to the native runner", async () => {
    const snapshot = await listCodexSkills({
      agentId: "agent-native",
      companyId: "company-1",
      adapterType: "pilibala_runner",
      config: {},
    });

    expect(snapshot.adapterType).toBe("pilibala_runner");
    expect(snapshot.desiredSkills).toEqual([]);
    expect(snapshot.entries.find((entry) => entry.key === pilibalaKey)?.state).toBe("available");
  });

  it("does not persist Pilibala skills into CODEX_HOME during sync", async () => {
    const codexHome = await makeTempDir("pilibala-codex-skill-prune-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        pilibalaSkillSync: {
          desiredSkills: [pilibalaKey],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, [pilibalaKey]);
    expect(after.mode).toBe("ephemeral");
    expect(after.entries.find((entry) => entry.key === pilibalaKey)?.state).toBe("configured");
    await expect(fs.lstat(path.join(codexHome, "skills", "pilibala"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("normalizes legacy flat Pilibala skill refs before reporting configured state", async () => {
    const codexHome = await makeTempDir("pilibala-codex-legacy-skill-sync-");
    cleanupDirs.add(codexHome);

    const snapshot = await listCodexSkills({
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        pilibalaSkillSync: {
          desiredSkills: ["pilibala"],
        },
      },
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.desiredSkills).toContain(pilibalaKey);
    expect(snapshot.desiredSkills).not.toContain("pilibala");
    expect(snapshot.entries.find((entry) => entry.key === pilibalaKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === "pilibala")).toBeUndefined();
  });
});
