import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@pilibalaai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createPilibalaRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"pilibala"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const pilibalaKey = "pilibalaai/pilibala/pilibala";
  const createAgentKey = "pilibalaai/pilibala/pilibala-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Pilibala skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("pilibala-codex-current-");
    const oldRepo = await makeTempDir("pilibala-codex-old-");
    const skillsHome = await makeTempDir("pilibala-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createPilibalaRepoSkill(currentRepo, "pilibala");
    await createPilibalaRepoSkill(currentRepo, "pilibala-create-agent");
    await createPilibalaRepoSkill(oldRepo, "pilibala");
    await fs.symlink(path.join(oldRepo, "skills", "pilibala"), path.join(skillsHome, "pilibala"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: pilibalaKey,
            runtimeName: "pilibala",
            source: path.join(currentRepo, "skills", "pilibala"),
          },
          {
            key: createAgentKey,
            runtimeName: "pilibala-create-agent",
            source: path.join(currentRepo, "skills", "pilibala-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "pilibala"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "pilibala")),
    );
    expect(await fs.realpath(path.join(skillsHome, "pilibala-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "pilibala-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "pilibala"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "pilibala-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Pilibala repo checkouts", async () => {
    const currentRepo = await makeTempDir("pilibala-codex-current-");
    const customRoot = await makeTempDir("pilibala-codex-custom-");
    const skillsHome = await makeTempDir("pilibala-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createPilibalaRepoSkill(currentRepo, "pilibala");
    await createCustomSkill(customRoot, "pilibala");
    await fs.symlink(path.join(customRoot, "custom", "pilibala"), path.join(skillsHome, "pilibala"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: pilibalaKey,
        runtimeName: "pilibala",
        source: path.join(currentRepo, "skills", "pilibala"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "pilibala"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "pilibala")),
    );
  });

  it("prunes broken symlinks for unavailable Pilibala repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("pilibala-codex-current-");
    const oldRepo = await makeTempDir("pilibala-codex-old-");
    const skillsHome = await makeTempDir("pilibala-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createPilibalaRepoSkill(currentRepo, "pilibala");
    await createPilibalaRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: pilibalaKey,
          runtimeName: "pilibala",
          source: path.join(currentRepo, "skills", "pilibala"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Pilibala skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("pilibala-codex-current-");
    const skillsHome = await makeTempDir("pilibala-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createPilibalaRepoSkill(currentRepo, "pilibala");
    await createPilibalaRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: pilibalaKey,
        runtimeName: "pilibala",
        source: path.join(currentRepo, "skills", "pilibala"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "pilibala"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});
