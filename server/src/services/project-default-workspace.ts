import { projects, projectWorkspaces, type Db } from "@pilibalaai/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { stat } from "node:fs/promises";
import { parseProjectExecutionWorkspacePolicy } from "./execution-workspace-policy.js";

type Reader = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

type CandidateRow = {
  id: string;
  lifecycle: string | null;
  cwd: string | null;
  repoUrl: string | null;
  remoteWorkspaceRef: string | null;
};

/**
 * A registration can serve as a new task's default only when it is usable right
 * now: standing lifecycle, and either a materializable repository/remote source
 * or a local directory that still exists. Dead local paths (removed worktrees
 * and checkouts) are skipped instead of poisoning new task bindings, and
 * task-ephemeral registrations are never default-eligible.
 */
export async function isHealthyProjectWorkspaceRow(row: CandidateRow): Promise<boolean> {
  if (row.lifecycle === "task_ephemeral") return false;
  if (row.repoUrl || row.remoteWorkspaceRef) return true;
  if (!row.cwd) return false;
  return stat(row.cwd)
    .then((stats) => stats.isDirectory())
    .catch(() => false);
}

export async function resolveProjectDefaultWorkspaceId(db: Reader, input: {
  companyId: string;
  projectId: string;
  policy?: ReturnType<typeof parseProjectExecutionWorkspacePolicy>;
}): Promise<string | null> {
  let policy = input.policy;
  if (policy === undefined) {
    const [project] = await db.select({ executionWorkspacePolicy: projects.executionWorkspacePolicy }).from(projects)
      .where(and(eq(projects.companyId, input.companyId), eq(projects.id, input.projectId)));
    policy = parseProjectExecutionWorkspacePolicy(project?.executionWorkspacePolicy);
  }
  if (policy?.defaultProjectWorkspaceId) return policy.defaultProjectWorkspaceId;
  const rows = await db.select({
    id: projectWorkspaces.id,
    lifecycle: projectWorkspaces.lifecycle,
    cwd: projectWorkspaces.cwd,
    repoUrl: projectWorkspaces.repoUrl,
    remoteWorkspaceRef: projectWorkspaces.remoteWorkspaceRef,
  }).from(projectWorkspaces)
    .where(and(eq(projectWorkspaces.companyId, input.companyId), eq(projectWorkspaces.projectId, input.projectId)))
    .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id));
  for (const row of rows) {
    if (await isHealthyProjectWorkspaceRow(row)) return row.id;
  }
  return null;
}
