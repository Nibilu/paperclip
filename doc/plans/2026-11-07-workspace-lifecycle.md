# Workspace lifecycle classes: standing / task-ephemeral / run-realization

Date: 2026-11-07. Governing spec section:
`doc/SPEC-implementation.md` → "Workspace lifecycle classes (2026-11-07)".

## Context

A one-off git worktree registered by an agent during AMB-93
(`/home/amber/paperclip-amb93-hermes`) became the project "pilibala debug"
registry's only `project_workspaces` row. When the worktree directory was later
removed, the registration row survived and, through
`resolveProjectDefaultWorkspaceId` (no health check, no lifecycle concept),
every subsequently created task and chat in the project inherited the dead
binding. Each run then re-resolved the dead path, emitted the
`WARNING: Configured project workspace is unavailable` log line, and fell back
to the per-issue isolated directory. The failure is top-level and
adapter-agnostic (observed on hermes engine=acp and codex_local lanes).

Root causes, all in the control plane:

1. Registrations have no lifecycle class: a run-scoped worktree enters the same
   table as an operator-owned standing checkout and can become the project
   default.
2. Default binding resolution performs no health validation and never expires.
3. The run resolver prefers the (dead) configured binding over the task's own
   prior session workspace, so continuity is lost exactly when the binding
   dies.

## Design

### Lifecycle classes

`project_workspaces.lifecycle`:

- `standing` — operator-owned registrations. Default-eligible, health-checked,
  never garbage-collected automatically.
- `task_ephemeral` — task-scoped registrations. Stable for the owning task's
  lifetime (including resume), excluded from default binding, excluded from
  other tasks' run resolution, garbage-collected when the owning task reaches a
  terminal status.

New column `project_workspaces.bound_issue_id` records the owning issue for
`task_ephemeral` rows (nullable; `standing` rows leave it null).

### Registration defaults

- Run-bound agent actor creates a workspace → `lifecycle = "task_ephemeral"`,
  `bound_issue_id` resolved from the actor's active run context (fallback: the
  request payload).
- Board/operator actor → `lifecycle = "standing"` unless the payload explicitly
  requests `task_ephemeral` with an issue.

### Default binding resolution (new tasks and chats)

`resolveProjectDefaultWorkspaceId` order:

1. Explicit project policy pin — authoritative, unchanged (existing bindings
   remain authoritative).
2. Otherwise, candidates are `standing` rows only, and a candidate is skipped
   when it is a local-path row (`cwd` set, no `repo_url`) whose directory does
   not exist. Among survivors the existing order applies: `isPrimary` desc,
   `createdAt` asc, `id` asc.
3. No healthy candidate → no default binding (the task runs unbound and the
   run resolver applies its own precedence).

### Run resolution precedence (all tasks, new and resumed)

In `resolveAnchorWorkspaceForRun`:

1. Healthy bound/configured workspace (unchanged).
2. The task's own prior session workspace — `previousSessionParams.cwd` with
   the existing safety checks — now also applies when the configured workspace
   is unavailable, instead of falling straight to the isolated directory.
3. Healthy project standing default (candidate list excludes `task_ephemeral`
   rows bound to other issues).
4. Managed isolated task directory (unchanged).

Relation to the dangling-pointer rule ("a dangling configured pointer does not
fall back"): unchanged for configured sources — a dead source never silently
re-binds to a different configured source. The task's own prior workspace is
not another configured source; it is the existing compatibility binding with
verified provenance, and it now outranks the isolated fallback.

### Garbage collection

On issue terminal transition (`done`, `cancelled`):

- Find `project_workspaces` rows with `lifecycle = "task_ephemeral"` and
  `bound_issue_id = <issue>`.
- Skip (and log) any row still referenced by another issue's
  `project_workspace_id`.
- Delete the row; delete the directory only when it resides under the
  instance-managed root (`resolvePilibalaInstanceRoot()` prefix). Directories
  outside the managed root are left for the operator; this is deliberate for
  v0.1 (no `rm -rf` on arbitrary registered paths).

## Module ownership

- `packages/db` — schema fields + additive migration (generated via
  `pnpm db:generate`, five-newest-snapshot retention per
  `rules/database-migration-snapshots.mdc`).
- `server/src/routes/projects.ts` + `services/projects.ts` +
  `packages/shared/src/validators/project.ts` — registration defaults and
  payload validation.
- `server/src/services/project-default-workspace.ts` — default binding
  health/lifecycle filtering.
- `server/src/services/heartbeat/workspaces.ts` — run resolution precedence
  (per `rules/heartbeat-execution-boundaries.mdc`, resolution stays in the
  workspaces module; the heartbeat coordinator is not grown).
- `server/src/services/workspace-lifecycle-gc.ts` (new) — terminal GC, hooked
  from the issue status transition in `services/issues.ts`.

All changes are top-level; no adapter package is touched. The mechanism
applies to every adapter by construction.

## Rollout

- Additive migration only (two nullable/defaulted columns); no destructive
  down migration. Existing rows read as `standing`.
- Deploy schema + code together; old rows keep working. No flag: the behavior
  change is the fix, and the fallback path it alters was already a degradation
  path.

## Verification

Unit tests:

1. Default resolution skips `task_ephemeral` and dead standing rows; policy pin
   still wins; empty result when nothing healthy.
2. Registration default: agent actor → `task_ephemeral` + bound issue;
   operator actor → `standing`.
3. Run resolution: dead configured binding + live prior session cwd → session
   workspace with warning (not isolated fallback); fresh task with no session →
   isolated fallback; ephemeral row bound to another issue is not a candidate.
4. GC: terminal transition removes the row and instance-root directories;
   retains rows referenced by other issues; leaves non-managed directories.

Dev E2E (after deploy): register `/home/amber/paperclip` as a standing primary
workspace on the "pilibala debug" project, create a new task, verify it binds
the healthy row and its first run carries no `Configured project workspace is
unavailable` warning; trigger a resume-style run on AMB-190 and verify
continuity via its saved task workspace.

### Verification record

- 2026-11-07: pending implementation.
- 2026-11-07: implemented (commit series on `clip_fork`).
  - Schema/migration: `project_workspaces.lifecycle` + `bound_issue_id` in
    `0357_keen_magneto.sql`; the migration also completes the stalled
    `paperclip` → `pilibala` field-name rebrand (chat_identity_links column
    rename, brand enum VALUES with data UPDATEs for tool_connections /
    company_secrets / user_secret_definitions, brand defaults, heartbeat_runs
    context index rename). Registered in
    `MIGRATIONS_WITH_TOP_LEVEL_STATEMENTS` (CONCURRENTLY index build) with
    `IF NOT EXISTS` for self-healing retry. check:migrations passed.
  - Registration (U2): run-bound agent actors default to `task_ephemeral` with
    `bound_issue_id` from the run's context snapshot; ephemeral rows can never
    take or steal the primary slot (service-enforced + validator-refused).
  - Default resolution (U3): health-gated — skips ephemeral rows and dead
    local-path rows; policy pin stays authoritative. Test-contract note: the
    organizational-defaults fixtures in `task-workspace-binding.test.ts` now
    materialize their registered directories (health-gated defaults require
    existing paths).
  - Run resolution (U4): `filterRunProjectWorkspaceCandidatesForIssue` in both
    anchor paths (fresh + reused git workspace); an explicit `configured_source`
    pin that points at another task's ephemeral row resolves as "selected
    workspace not available" instead of hijacking the run. Continuity branch
    (dead inherited default → the task's own prior session cwd) is gated on
    `!configuredSourceId`: explicit pins keep the strict refusal contract.
  - Terminal GC (U5): post-commit action on done/cancelled reaps bound
    ephemeral rows; directories deleted only inside the instance-managed
    `isolated-workspaces/<company>/<issue>` subtree; external directories are
    retained and activity-logged (`issue.task_ephemeral_workspace_gc`).
  - Tests: new `workspace-lifecycle-gc.test.ts` 11/11 green (embedded PG);
    `task-workspace-binding` 67/70 (3 failures pre-existing on clean HEAD —
    the "refuses sibling and session fallbacks" suite expects a loud
    rejection layer that an earlier refactor moved out of
    `resolveWorkspaceForRun`); `heartbeat-workspace-session` 176/178 (2
    pre-existing failures on clean HEAD). Server/shared/db typecheck green.
  - Follow-up (pre-existing, out of scope): restore the loud-rejection layer
    for dead explicit `configured_source` pins (currently the anchor falls
    back to the isolated directory with only a run-log warning).
  - Dev E2E (2026-11-07, dev :3104 after 0357 applied live):
    - Migration: `Migrations complete` at boot; `project_workspaces.lifecycle`
      + `bound_issue_id` present; brand data rebranded (tool_connections 6 →
      pilibala_vault, company_secrets 6 → pilibala_managed); journal records
      0357; environments index rebuilt pilibala-keyed. Two apply failures were
      hit and fixed inside 0357 before any durable application: the stale
      rebrand snapshot had already-renamed columns on dev (rename is now a
      conditional DO block) and the UPDATE ran under the legacy CHECK
      (constraints now drop before the data rebrand). All statements are
      drift-robust (IF NOT EXISTS / conditional) so fresh databases and the
      drifted dev database both converge on the same end state.
    - U2 live: a run-bound agent registration via the API came back
      `task_ephemeral` bound to the run's issue, never primary.
    - U3 live: a service-level create in the debug project bound the healthy
      standing row (89e2735c) and skipped the dead AMB-93 row.
    - U4/inheritance: tasks created from an AMB-190 run context inherit that
      task's shared execution workspace (by design, task-family continuity);
      the direct project-workspace inheritance branch is now health-gated so a
      dead inherited registration falls through to the health-gated project
      default instead of propagating the dead pointer. (0357-adjacent fix in
      `issues.ts`, verified by direct service create binding 89e2735c.)
    - U5 live: a bound ephemeral row + managed directory were reaped by the
      real terminal transition (done), directory deleted under the managed
      root, activity entry `issue.task_ephemeral_workspace_gc` written, other
      projects' rows untouched.
