/** Run-bound diagnostics cannot mutate task state, comments, approvals, or holds. */
export function reconciliationAnalysisWriteAllowed(context: Record<string, unknown> | null | undefined, method: string, path: string) {
  if (context?.wakeReason !== "reconciliation_analysis") return true;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  return method === "POST" && path === `/api/issues/${context.analysisSourceIssueId}/recovery-actions/agent-draft`;
}
