import type { WorkspaceRuntimeControlTarget } from "@pilibalaai/shared";

export function sanitizeWorkspaceRuntimeControlTarget(
  target: WorkspaceRuntimeControlTarget = {},
): WorkspaceRuntimeControlTarget {
  return {
    workspaceCommandId: target.workspaceCommandId ?? null,
    runtimeServiceId: target.runtimeServiceId ?? null,
    serviceIndex: target.serviceIndex ?? null,
  };
}
