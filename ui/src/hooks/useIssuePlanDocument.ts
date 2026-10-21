import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { IssueDocument } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The issue's `plan` document, or null when none exists ("no plan yet" is a
 * normal state, not an error). Shared by the redesigned thread (its "Plan
 * updated" marker) and the properties pane's Plan tab, so both consume one
 * cached fetch. Keyed under queryKeys.issues.documents so document-scope
 * invalidations refresh it.
 *
 * Existence is resolved from the issue's documents list instead of probing
 * `GET /documents/plan` and handling its 404: the list endpoint returns full
 * document bodies (plan is not a system key, so it is included), always
 * answers 200, and is usually already cached by the artifacts/properties
 * surfaces on the same task page. `plan` appearing mid-run (agent writes it
 * while planning) re-derives through the same document-scope invalidations
 * that used to re-trigger the 404 probe.
 */
export function useIssuePlanDocument(issueId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useQuery<IssueDocument | null>({
    queryKey: [...queryKeys.issues.documents(issueId ?? ""), "plan"],
    enabled: Boolean(issueId) && !issueId?.startsWith("chat:"),
    queryFn: async () => {
      const plan = await readPlanDocument(queryClient, issueId!);
      return plan;
    },
  });
}

async function readPlanDocument(
  queryClient: QueryClient,
  issueId: string,
): Promise<IssueDocument | null> {
  // Prefer the shared list cache: no request when the task page already
  // fetched the documents list.
  const cachedList = queryClient.getQueryData<IssueDocument[]>(
    [...queryKeys.issues.documents(issueId), "list"],
  );
  if (cachedList) {
    return cachedList.find((document) => document.key === "plan") ?? null;
  }

  try {
    const list = await issuesApi.listDocuments(issueId);
    // Seed the shared list cache so every other consumer (artifacts tab,
    // properties pane) reuses this response instead of refetching.
    queryClient.setQueryData<IssueDocument[]>(
      [...queryKeys.issues.documents(issueId), "list"],
      list,
    );
    return list.find((document) => document.key === "plan") ?? null;
  } catch (error) {
    // A transient list failure must not surface as a plan error; consumers
    // render "no plan yet" and the next invalidation retries.
    if (error instanceof ApiError && error.status >= 500) return null;
    throw error;
  }
}
