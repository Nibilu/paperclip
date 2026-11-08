import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleAlert, Loader2, Play } from "lucide-react";
import { agentsApi, type CapabilityUpgradeTaskSummary } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentCapabilityDiffEntry, AgentCapabilityObservation } from "@pilibalaai/shared";

/**
 * Manual adapter capability check panel (SPEC-implementation 11.2). Explicit
 * user action only: no polling, no background refresh. Renders the latest
 * observation, the diff against the previous check, and the upgrade-task hint
 * when the diff found concrete added/removed/changed capabilities.
 */

type CheckState = "idle" | "running" | "pass" | "fail";

const stateCopy: Record<CheckState, { title: string; description: string; action: string }> = {
  idle: {
    title: "Check capabilities",
    description: "Ask the configured Hermes Gateway which operations it actually supports.",
    action: "Check capabilities",
  },
  running: {
    title: "Checking capabilities",
    description: "Querying the gateway capability document…",
    action: "Checking…",
  },
  pass: {
    title: "Capability check complete",
    description: "Review the supported operations and any changes below.",
    action: "Check again",
  },
  fail: {
    title: "Capability check failed",
    description: "The gateway did not return a usable capability document.",
    action: "Retry check",
  },
};

const DIFF_LABEL: Record<AgentCapabilityDiffEntry["kind"], string> = {
  added: "New",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
};

function checkStateOf(latest: AgentCapabilityObservation | null, errored: boolean): CheckState {
  if (errored) return "fail";
  if (!latest) return "idle";
  if (latest.error) return "fail";
  return "pass";
}

export function CapabilityCheckCard({
  companyId,
  agentId,
  adapterType,
  disabled = false,
}: {
  companyId: string;
  agentId: string;
  adapterType: string;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const enabled = adapterType === "hermes_gateway";

  const observationsQuery = useQuery({
    queryKey: ["agent-capability-observations", agentId],
    queryFn: () => agentsApi.capabilityObservations(agentId, companyId),
    enabled,
    staleTime: 30_000,
  });

  const check = useMutation({
    mutationFn: () => agentsApi.capabilityCheck(agentId, companyId),
    onSuccess: (result) => {
      // Seed the observations cache with the fresh result so the panel shows
      // the new state immediately.
      queryClient.setQueryData<{ observations: AgentCapabilityObservation[] }>(
        ["agent-capability-observations", agentId],
        (previous) => ({
          observations: [result.observation, ...(previous?.observations ?? []).filter((o) => o.id !== result.observation.id)],
        }),
      );
    },
  });

  const upgradeTaskRequired = check.data?.upgradeTaskRequired ?? false;

  const upgradeTasksQuery = useQuery({
    queryKey: ["agent-capability-upgrade-tasks", agentId],
    queryFn: () => agentsApi.capabilityUpgradeTasks(agentId, companyId),
    enabled,
    staleTime: 15_000,
  });

  const companyAgentsQuery = useQuery({
    queryKey: ["company-agents-for-picker", companyId],
    queryFn: () => agentsApi.list(companyId),
    enabled: enabled && upgradeTaskRequired,
  });

  const [selectedUpgradeAgentId, setSelectedUpgradeAgentId] = useState<string>("");
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const submitUpgrade = useMutation({
    mutationFn: () => {
      if (!latest?.id) throw new Error("No capability check result to attach");
      return agentsApi.submitCapabilityUpgradeTask(agentId, companyId, {
        upgradeAgentId: selectedUpgradeAgentId,
        observationId: latest.id,
      });
    },
    onSuccess: () => {
      setUpgradeError(null);
      void queryClient.invalidateQueries({ queryKey: ["agent-capability-upgrade-tasks", agentId] });
    },
    onError: (err) => setUpgradeError(err instanceof Error ? err.message : "Upgrade task submission failed."),
  });

  const confirmUpgrade = useMutation({
    mutationFn: (issueId: string) => agentsApi.confirmCapabilityUpgradeTask(issueId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-capability-upgrade-tasks", agentId] });
    },
  });

  if (!enabled) return null;

  const latest = observationsQuery.data?.observations[0] ?? check.data?.observation ?? null;
  const diff = check.data?.diff ?? [];

  const state = checkStateOf(latest, check.isError);
  const Icon = state === "running" ? Loader2 : state === "pass" ? CircleCheck : state === "fail" ? CircleAlert : Play;
  const content = stateCopy[check.isPending ? "running" : state];
  const observationError = latest?.error ?? null;

  return (
    <section aria-label="Adapter capability check" className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 p-4 sm:items-center">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted",
            state === "pass" ? "text-green-600 dark:text-green-400" : state === "fail" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <Icon className={cn("size-4", check.isPending && "animate-spin motion-reduce:animate-none")} />
        </span>
        <div
          role={state === "fail" ? "alert" : "status"}
          aria-atomic="true"
          className="min-w-0 flex-1 space-y-1"
        >
          <h3 className="text-sm font-medium">{content.title}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {check.isError
              ? check.error instanceof Error
                ? check.error.message
                : "The capability check request failed."
              : latest && observationError
                ? `${observationError.code} — ${observationError.nextAction ?? observationError.message ?? ""}`
                : content.description}
          </p>
          {latest ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <div className="flex gap-1">
                <dt>State:</dt>
                <dd className="text-foreground">{latest.state}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Endpoint:</dt>
                <dd className="text-foreground">{latest.endpointLabel}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Protocol:</dt>
                <dd className="text-foreground">{latest.protocolVersion ?? "unknown"}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Revision:</dt>
                <dd className="text-foreground">{latest.revision}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Checked:</dt>
                <dd className="text-foreground">{new Date(latest.checkedAt).toLocaleString()}</dd>
              </div>
            </dl>
          ) : null}
          {latest && !observationError ? (
            <ul className="grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
              {Object.entries(latest.operations).map(([op, opState]) => (
                <li key={op} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block size-1.5 rounded-full",
                      opState.supported ? "bg-green-600 dark:bg-green-400" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="text-foreground">{op}</span>
                  <span>{opState.supported ? "supported" : "not supported"}</span>
                  {opState.endpoint ? <span className="truncate">({opState.endpoint})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {diff.some((entry) => entry.kind !== "unchanged") ? (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-foreground">Changes since last check</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {diff
                  .filter((entry) => entry.kind !== "unchanged")
                  .map((entry, index) => (
                    <li key={`${entry.scope}-${entry.key}-${index}`}>
                      <span className="text-foreground">{DIFF_LABEL[entry.kind]}</span> {entry.scope}{" "}
                      <span className="text-foreground">{entry.key}</span>
                      {entry.scope === "operation" && entry.kind === "added" ? " — newly supported" : ""}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {latest && !observationError && diff.length > 0 && !diff.some((entry) => entry.kind !== "unchanged") ? (
            <p className="text-xs text-muted-foreground">No capability changes since the previous check.</p>
          ) : null}
          {upgradeTaskRequired ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
              <p className="text-xs text-muted-foreground">
                A capability gap that requires development work was detected. Select an agent and create an upgrade task to close it.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Agent to perform the upgrade"
                  className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  value={selectedUpgradeAgentId}
                  onChange={(event) => setSelectedUpgradeAgentId(event.target.value)}
                >
                  <option value="">Select agent…</option>
                  {(companyAgentsQuery.data ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => submitUpgrade.mutate()}
                  disabled={disabled || !selectedUpgradeAgentId || submitUpgrade.isPending}
                >
                  {submitUpgrade.isPending ? "Creating…" : "Create upgrade task"}
                </Button>
              </div>
              {submitUpgrade.data ? (
                <p className="text-xs text-foreground" role="status">
                  Upgrade task {submitUpgrade.data.identifier ?? ""} created and waiting for your confirmation before it enters the scheduler.
                </p>
              ) : null}
              {upgradeError ? (
                <p className="text-xs text-destructive" role="alert">{upgradeError}</p>
              ) : null}
            </div>
          ) : null}
          {(upgradeTasksQuery.data?.tasks ?? []).length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Capability upgrade tasks</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {(upgradeTasksQuery.data?.tasks ?? []).map((task: CapabilityUpgradeTaskSummary) => {
                  const verifiedAfterUpgrade =
                    task.provenance?.capabilityRevision != null &&
                    latest?.revision != null &&
                    latest.revision !== task.provenance.capabilityRevision &&
                    !latest.error;
                  return (
                    <li key={task.issueId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-foreground">{task.identifier ?? task.title}</span>
                      <span>({task.status})</span>
                      {task.provenance ? (
                        <span>from check {task.provenance.observationId.slice(0, 8)}</span>
                      ) : null}
                      {verifiedAfterUpgrade ? (
                        <span className="text-green-600 dark:text-green-400">verified by recheck</span>
                      ) : null}
                      {task.status === "todo" &&
                      !task.admissionGateConfirmedAt &&
                      submitUpgrade.data?.issueId !== task.issueId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => confirmUpgrade.mutate(task.issueId)}
                          disabled={confirmUpgrade.isPending}
                        >
                          {confirmUpgrade.isPending ? "Confirming…" : "Confirm and schedule"}
                        </Button>
                      ) : null}
                      {task.admissionGateConfirmedAt ? (
                        <span role="status">confirmed — task enters the scheduler</span>
                      ) : confirmUpgrade.data && confirmUpgrade.variables === task.issueId ? (
                        <span role="status">confirmed — task enters the scheduler</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => check.mutate()}
          disabled={disabled || check.isPending}
        >
          {content.action}
        </Button>
      </div>
    </section>
  );
}
