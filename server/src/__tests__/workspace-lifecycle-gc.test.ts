import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  authUsers,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  projectWorkspaces,
  projects,
  type Db,
} from "@pilibalaai/db";
import { createProjectWorkspaceSchema } from "@pilibalaai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { projectService } from "../services/projects.js";
import { resolveProjectDefaultWorkspaceId } from "../services/project-default-workspace.js";
import {
  filterRunProjectWorkspaceCandidatesForIssue,
} from "../services/heartbeat/workspaces.js";
import { executeIssuePostCommitActions } from "../services/issues.js";
import { reapTaskEphemeralWorkspacesForIssue } from "../services/task-workspace-gc.js";
import { resolvePilibalaInstanceRoot } from "../home-paths.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("workspace lifecycle (standing / task_ephemeral)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pilibala-workspace-lifecycle-"));
    vi.stubEnv("PILIBALA_HOME", path.join(root, "home"));
    database = await startEmbeddedPostgresTestDatabase("workspace-lifecycle");
    db = createDb(database.connectionString);
    await db.insert(authUsers).values({
      id: "lifecycle-owner",
      name: "Lifecycle owner",
      email: "lifecycle-owner@example.test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }, 60_000);

  async function createCompanyProject(): Promise<{ companyId: string; projectId: string }> {
    const companyId = randomUUID();
    const projectId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Lifecycle ${companyId.slice(0, 6)}`,
      issuePrefix: `L${companyId.slice(0, 6)}`,
      defaultResponsibleUserId: "lifecycle-owner",
    });
    await db.insert(projects).values({ id: projectId, companyId, name: "Lifecycle project" });
    return { companyId, projectId };
  }

  describe("registration defaults (U2)", () => {
    it("forces a task-ephemeral registration off the primary slot and keeps its issue binding", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const cwd = await mkdtemp(path.join(root, "ephemeral-"));
      const issueId = randomUUID();
      const created = await projectService(db).createWorkspace(projectId, {
        name: "Run worktree",
        sourceType: "local_path",
        cwd,
        isPrimary: true,
        lifecycle: "task_ephemeral",
        boundIssueId: issueId,
      });
      expect(created).not.toBeNull();
      expect(created!.lifecycle).toBe("task_ephemeral");
      expect(created!.boundIssueId).toBe(issueId);
      expect(created!.isPrimary).toBe(false);
      const [row] = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.projectId, projectId));
      expect(row.lifecycle).toBe("task_ephemeral");
      expect(row.isPrimary).toBe(false);
    });

    it("defaults a plain registration to the standing lifecycle", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const cwd = await mkdtemp(path.join(root, "standing-"));
      const created = await projectService(db).createWorkspace(projectId, {
        name: "Dev checkout",
        sourceType: "local_path",
        cwd,
        isPrimary: true,
      });
      expect(created!.lifecycle).toBe("standing");
      expect(created!.isPrimary).toBe(true);
      expect(created!.boundIssueId ?? null).toBeNull();
    });

    it("rejects an explicit task-ephemeral primary at the validation layer", () => {
      const parsed = createProjectWorkspaceSchema.safeParse({
        name: "Run worktree",
        sourceType: "local_path",
        cwd: "/tmp/somewhere",
        isPrimary: true,
        lifecycle: "task_ephemeral",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("project default resolution (U3)", () => {
    it("skips dead local paths and other tasks' ephemeral registrations", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const deadCwd = path.join(root, "deleted-worktree", randomUUID());
      const healthyCwd = await mkdtemp(path.join(root, "healthy-"));
      const ephemeralCwd = await mkdtemp(path.join(root, "ephemeral-"));
      const deadId = randomUUID();
      const healthyId = randomUUID();
      const ephemeralId = randomUUID();
      await db.insert(projectWorkspaces).values([
        { id: deadId, companyId, projectId, name: "Dead worktree", sourceType: "local_path", cwd: deadCwd, isPrimary: true },
        { id: healthyId, companyId, projectId, name: "Dev checkout", sourceType: "local_path", cwd: healthyCwd, isPrimary: false },
        { id: ephemeralId, companyId, projectId, name: "Run worktree", sourceType: "local_path", cwd: ephemeralCwd, isPrimary: false, lifecycle: "task_ephemeral", boundIssueId: randomUUID() },
      ]);
      const resolved = await resolveProjectDefaultWorkspaceId(db, { companyId, projectId });
      expect(resolved).toBe(healthyId);
    });

    it("returns null when every standing registration is dead and the rest are ephemeral", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const deadCwd = path.join(root, "deleted-checkout", randomUUID());
      const ephemeralCwd = await mkdtemp(path.join(root, "ephemeral-"));
      await db.insert(projectWorkspaces).values([
        { id: randomUUID(), companyId, projectId, name: "Dead checkout", sourceType: "local_path", cwd: deadCwd, isPrimary: true },
        { id: randomUUID(), companyId, projectId, name: "Run worktree", sourceType: "local_path", cwd: ephemeralCwd, isPrimary: false, lifecycle: "task_ephemeral", boundIssueId: randomUUID() },
      ]);
      const resolved = await resolveProjectDefaultWorkspaceId(db, { companyId, projectId });
      expect(resolved).toBeNull();
    });

    it("keeps an explicit policy pin authoritative even when the pinned path is dead", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const deadCwd = path.join(root, "deleted-pinned", randomUUID());
      const pinnedId = randomUUID();
      await db.insert(projectWorkspaces).values([
        { id: pinnedId, companyId, projectId, name: "Pinned dead", sourceType: "local_path", cwd: deadCwd, isPrimary: true },
      ]);
      await db.update(projects).set({
        executionWorkspacePolicy: { defaultProjectWorkspaceId: pinnedId },
      }).where(eq(projects.id, projectId));
      const resolved = await resolveProjectDefaultWorkspaceId(db, { companyId, projectId });
      expect(resolved).toBe(pinnedId);
    });
  });

  describe("run candidate filter (U4)", () => {
    const rows = (lifecycles: Array<{ id: string; lifecycle?: string; boundIssueId?: string }>) => lifecycles;

    it("excludes ephemeral registrations bound to other issues and unbound ones", () => {
      const issueId = randomUUID();
      const standing = { id: "standing" };
      const own = { id: "own", lifecycle: "task_ephemeral", boundIssueId: issueId };
      const foreign = { id: "foreign", lifecycle: "task_ephemeral", boundIssueId: randomUUID() };
      const unbound = { id: "unbound", lifecycle: "task_ephemeral" };
      const filtered = filterRunProjectWorkspaceCandidatesForIssue(
        rows([standing, own, foreign, unbound]),
        { configuredSourceId: null, issueId },
      );
      expect(filtered.map((row) => row.id)).toEqual(["standing", "own"]);
    });

    it("narrowing to a foreign ephemeral pin yields an empty candidate set", () => {
      const foreign = { id: "foreign", lifecycle: "task_ephemeral", boundIssueId: randomUUID() };
      const filtered = filterRunProjectWorkspaceCandidatesForIssue(
        rows([foreign]),
        { configuredSourceId: "foreign", issueId: randomUUID() },
      );
      expect(filtered).toEqual([]);
    });

    it("keeps a standing row under an explicit pin and no issue context", () => {
      const standing = { id: "standing" };
      const filtered = filterRunProjectWorkspaceCandidatesForIssue(
        rows([standing]),
        { configuredSourceId: "standing", issueId: null },
      );
      expect(filtered.map((row) => row.id)).toEqual(["standing"]);
    });
  });

  describe("terminal GC (U5)", () => {
    it("reaps ephemeral registrations bound to the issue, deleting only managed directories", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const issueId = randomUUID();
      const otherIssueId = randomUUID();
      const instanceRoot = resolvePilibalaInstanceRoot();
      const managedDir = path.join(instanceRoot, "isolated-workspaces", companyId, issueId);
      await mkdir(managedDir, { recursive: true });
      await writeFile(path.join(managedDir, "scratch.txt"), "managed");
      const externalDir = await mkdtemp(path.join(root, "external-worktree-"));
      await writeFile(path.join(externalDir, "keep.txt"), "external");
      const standingCwd = await mkdtemp(path.join(root, "standing-"));

      const managedId = randomUUID();
      const externalId = randomUUID();
      const standingId = randomUUID();
      const otherIssueEphemeralId = randomUUID();
      await db.insert(projectWorkspaces).values([
        { id: managedId, companyId, projectId, name: "Managed run dir", sourceType: "local_path", cwd: managedDir, isPrimary: false, lifecycle: "task_ephemeral", boundIssueId: issueId },
        { id: externalId, companyId, projectId, name: "Agent worktree", sourceType: "local_path", cwd: externalDir, isPrimary: false, lifecycle: "task_ephemeral", boundIssueId: issueId },
        { id: standingId, companyId, projectId, name: "Dev checkout", sourceType: "local_path", cwd: standingCwd, isPrimary: true },
        { id: otherIssueEphemeralId, companyId, projectId, name: "Other run", sourceType: "local_path", cwd: externalDir, isPrimary: false, lifecycle: "task_ephemeral", boundIssueId: otherIssueId },
      ]);

      const result = await reapTaskEphemeralWorkspacesForIssue(db, { companyId, issueId });
      expect(result.removedWorkspaceIds.sort()).toEqual([externalId, managedId].sort());
      expect(result.deletedDirectories).toEqual([managedDir]);
      expect(result.retainedExternalDirectories).toEqual([externalDir]);
      await expect(stat(managedDir)).rejects.toThrow();
      await expect(stat(path.join(externalDir, "keep.txt"))).resolves.toBeTruthy();

      const remaining = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.projectId, projectId));
      expect(remaining.map((row) => row.id).sort()).toEqual([standingId, otherIssueEphemeralId].sort());

      const events = await db.select().from(activityLog).where(and(
        eq(activityLog.companyId, companyId),
        eq(activityLog.action, "issue.task_ephemeral_workspace_gc"),
      ));
      expect(events.length).toBe(1);
      expect(events[0]!.entityId).toBe(issueId);
    });

    it("runs from the issue post-commit action queue", async () => {
      const { companyId, projectId } = await createCompanyProject();
      const issueId = randomUUID();
      const managedDir = path.join(resolvePilibalaInstanceRoot(), "isolated-workspaces", companyId, issueId);
      await mkdir(managedDir, { recursive: true });
      const ephemeralId = randomUUID();
      await db.insert(projectWorkspaces).values({
        id: ephemeralId,
        companyId,
        projectId,
        name: "Queued run dir",
        sourceType: "local_path",
        cwd: managedDir,
        isPrimary: false,
        lifecycle: "task_ephemeral",
        boundIssueId: issueId,
      });
      await executeIssuePostCommitActions(db as Db, [
        { type: "task_ephemeral_workspace_gc", companyId, issueId, issueStatus: "done" },
      ]);
      const rows = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.id, ephemeralId));
      expect(rows).toHaveLength(0);
      await expect(stat(managedDir)).rejects.toThrow();
    });
  });
});
