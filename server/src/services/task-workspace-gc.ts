import path from "node:path";
import { realpath, rm } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { projectWorkspaces, type Db } from "@pilibalaai/db";
import { resolvePilibalaInstanceRoot } from "../home-paths.js";
import { logActivity } from "./activity-log.js";

const TASK_EPHEMERAL_LIFECYCLE = "task_ephemeral";

export type TaskEphemeralWorkspaceReapResult = {
  removedWorkspaceIds: string[];
  deletedDirectories: string[];
  retainedExternalDirectories: string[];
};

/**
 * Task-ephemeral registrations are task-scoped by construction (see the
 * workspace lifecycle plan): the registration row belongs to exactly one issue
 * and must not outlive that issue. When the bound issue reaches a terminal
 * status the registration is dropped, and the workspace directory is deleted
 * only when it lives inside the Pilibala-managed isolated-workspaces subtree
 * for that issue. Directories outside the managed root (agent-created
 * checkouts/worktrees in operator paths) are left on disk for the operator to
 * inspect or delete; only the registration is removed.
 */
export async function reapTaskEphemeralWorkspacesForIssue(
  db: Db,
  input: { companyId: string; issueId: string },
): Promise<TaskEphemeralWorkspaceReapResult> {
  const rows = await db
    .select({
      id: projectWorkspaces.id,
      name: projectWorkspaces.name,
      cwd: projectWorkspaces.cwd,
    })
    .from(projectWorkspaces)
    .where(and(
      eq(projectWorkspaces.companyId, input.companyId),
      eq(projectWorkspaces.boundIssueId, input.issueId),
      eq(projectWorkspaces.lifecycle, TASK_EPHEMERAL_LIFECYCLE),
    ));

  const result: TaskEphemeralWorkspaceReapResult = {
    removedWorkspaceIds: [],
    deletedDirectories: [],
    retainedExternalDirectories: [],
  };
  if (rows.length === 0) return result;

  const managedRoot = await realpath(resolvePilibalaInstanceRoot()).catch(() => null);

  for (const row of rows) {
    result.removedWorkspaceIds.push(row.id);
    const cwd = typeof row.cwd === "string" ? row.cwd.trim() : "";
    if (!cwd || !managedRoot) {
      if (cwd) result.retainedExternalDirectories.push(cwd);
      continue;
    }
    const resolved = await realpath(cwd).catch(() => null);
    const managedBase = path.join(managedRoot, "isolated-workspaces", input.companyId, input.issueId);
    const rel = resolved ? path.relative(managedBase, resolved) : null;
    // The task's isolated directory IS the managed base itself (rel === "");
    // deeper descendants are also ours. Anything escaping the base is retained.
    const insideManagedSubtree = rel !== null && !rel.startsWith("..") && !path.isAbsolute(rel);
    if (resolved && insideManagedSubtree) {
      const deleted = await rm(resolved, { recursive: true, force: true })
        .then(() => true)
        .catch(() => false);
      if (deleted) result.deletedDirectories.push(cwd);
      else result.retainedExternalDirectories.push(cwd);
    } else {
      result.retainedExternalDirectories.push(cwd);
    }
  }

  if (result.removedWorkspaceIds.length > 0) {
    await db
      .delete(projectWorkspaces)
      .where(and(
        eq(projectWorkspaces.companyId, input.companyId),
        eq(projectWorkspaces.boundIssueId, input.issueId),
        eq(projectWorkspaces.lifecycle, TASK_EPHEMERAL_LIFECYCLE),
      ));
  }

  if (result.removedWorkspaceIds.length > 0 || result.deletedDirectories.length > 0) {
    await logActivity(db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: "task_workspace_gc",
      action: "issue.task_ephemeral_workspace_gc",
      entityType: "issue",
      entityId: input.issueId,
      details: { ...result },
    });
  }

  return result;
}
