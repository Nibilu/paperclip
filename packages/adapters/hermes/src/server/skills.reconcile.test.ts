import { mkdir, mkdtemp, readdir, readlink, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

import { reconcileHermesPaperclipSkills } from "./skills.js";

/**
 * AMB-108: a foreign entry occupying a Paperclip-managed skill path in the
 * shared Hermes skills home used to hard-crash every hermes_local agent start
 * ("occupied by another installation"). The reconciler now quarantines
 * foreign symlinks/plain files into `<skillsHome>/.archive/` (rename only —
 * nothing deleted), recreates the managed link, and reports the move via the
 * notice callback. Real directories still fail, but with actionable guidance.
 *
 * resolveHermesHome prefers HERMES_HOME, so every fixture points it at a
 * dedicated temp dir; the skills home is then <hermesHome>/skills. The
 * bundled skill set is the adapter's own skills/ directory, so its key is
 * requested explicitly — an empty desired set means "nothing to reconcile".
 */

const tempHomes: string[] = [];

afterEach(async () => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) await rm(home, { recursive: true, force: true });
  }
});

const thisDir = fileURLToPath(import.meta.url);
// src/server/skills.reconcile.test.ts -> <pkg>/skills
const bundledSkillsRoot = join(thisDir, "..", "..", "skills");
const BUNDLED_SKILL_KEY = "paperclipai/paperclip/paperclip-task-bridge";

async function makeFixture(): Promise<{ home: string; skillsHome: string }> {
  const home = await mkdtemp(join(tmpdir(), "paperclip-amb108-"));
  tempHomes.push(home);
  const hermesHome = join(home, ".hermes");
  const skillsHome = join(hermesHome, "skills");
  await mkdir(skillsHome, { recursive: true });
  return { home, skillsHome };
}

function hermesConfig(home: string): Record<string, unknown> {
  return { env: { HOME: home, HERMES_HOME: join(home, ".hermes") } };
}

test("foreign symlink at a managed skill path is quarantined and the managed link recreated", async () => {
  const { home, skillsHome } = await makeFixture();
  const foreignTargetDir = join(home, "dev-checkout-skills", "paperclip-task-bridge");
  await mkdir(foreignTargetDir, { recursive: true });
  await writeFile(
    join(foreignTargetDir, "SKILL.md"),
    "---\nname: paperclip-task-bridge\n---\nforeign tree\n",
  );
  const target = join(skillsHome, "paperclip-task-bridge");
  await symlink(foreignTargetDir, target);

  const notices: string[] = [];
  const desired = await reconcileHermesPaperclipSkills(
    hermesConfig(home),
    [BUNDLED_SKILL_KEY],
    (line) => {
      notices.push(line);
    },
  );
  expect(desired).toContain(BUNDLED_SKILL_KEY);

  // Managed link restored and resolvable to the bundled source.
  const link = await readlink(target);
  expect(link.length).toBeGreaterThan(0);
  const linked = await readFile(join(target, "SKILL.md"), "utf8");
  expect(linked).not.toContain("foreign tree");
  expect(linked).toContain("name: paperclip-task-bridge");
  // Quarantine archive received the foreign link (rename, not delete).
  const archiveDir = join(skillsHome, ".archive");
  const archived = await readdir(archiveDir);
  expect(archived.length).toBe(1);
  expect(archived[0]).toMatch(/^paperclip-task-bridge\.foreign-/);
  // The notice reports what moved where.
  expect(
    notices.some(
      (line) =>
        line.includes("Quarantined foreign skill entry") && line.includes(archiveDir),
    ),
  ).toBe(true);

  // Reconcile is now clean and idempotent (no further notices).
  const noticesAgain: string[] = [];
  const desiredAgain = await reconcileHermesPaperclipSkills(
    hermesConfig(home),
    [BUNDLED_SKILL_KEY],
    (line) => {
      noticesAgain.push(line);
    },
  );
  expect(noticesAgain).toEqual([]);
  expect(desiredAgain).toEqual(desired);
  expect(await readlink(target)).toBe(link);
});

test("foreign plain file at a managed skill path is quarantined", async () => {
  const { home, skillsHome } = await makeFixture();
  await writeFile(join(skillsHome, "paperclip-task-bridge"), "stray file");

  const notices: string[] = [];
  await reconcileHermesPaperclipSkills(hermesConfig(home), [BUNDLED_SKILL_KEY], (line) => {
    notices.push(line);
  });

  expect(notices.some((line) => line.includes("(file) at"))).toBe(true);
  const linked = await readFile(
    join(skillsHome, "paperclip-task-bridge", "SKILL.md"),
    "utf8",
  );
  expect(linked).toContain("name: paperclip-task-bridge");
  const archived = await readdir(join(skillsHome, ".archive"));
  expect(archived[0]).toMatch(/^paperclip-task-bridge\.foreign-/);
});

test("real directory occupant is never moved: run fails with actionable guidance", async () => {
  const { home, skillsHome } = await makeFixture();
  const target = join(skillsHome, "paperclip-task-bridge");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "SKILL.md"),
    "---\nname: paperclip-task-bridge\n---\nuser tree\n",
  );

  const notices: string[] = [];
  await expect(
    reconcileHermesPaperclipSkills(hermesConfig(home), [BUNDLED_SKILL_KEY], (line) => {
      notices.push(line);
    }),
  ).rejects.toThrow(/is occupied by another installation/);

  // The user tree is untouched, and the message carries the fix recipe.
  const untouched = await readFile(join(target, "SKILL.md"), "utf8");
  expect(untouched).toContain("user tree");
  expect(notices).toEqual([]);
});

test("clean home reconciles without quarantine notices (Reconciled-count path unaffected)", async () => {
  const { home, skillsHome } = await makeFixture();
  const notices: string[] = [];
  const desired = await reconcileHermesPaperclipSkills(hermesConfig(home), [BUNDLED_SKILL_KEY], (line) => {
    notices.push(line);
  });
  expect(desired).toContain(BUNDLED_SKILL_KEY);
  expect(notices).toEqual([]);
  const linked = await readFile(
    join(skillsHome, "paperclip-task-bridge", "SKILL.md"),
    "utf8",
  );
  expect(linked).toContain("name: paperclip-task-bridge");
});
