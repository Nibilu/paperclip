// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExecutionReconciliationPanel } from "./ExecutionReconciliationPanel";
import { issuesApi } from "../api/issues";
import type { ExecutionBlocker, IssueRecoveryAction } from "@paperclipai/shared";

vi.mock("../api/issues", () => ({ issuesApi: { resolveRecoveryAction: vi.fn() } }));
vi.mock("../lib/router", () => ({
  Link: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props} />,
}));

describe("ExecutionReconciliationPanel", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  const onResolved = vi.fn();
  const action = { id: "recovery-1", evidence: { runId: "run-1" } } as unknown as IssueRecoveryAction;
  const blocker = {
    recoveryActionId: "recovery-1", runId: "run-1", agentId: "agent-1",
    cause: "legacy_execution_requires_reconciliation",
    nextAction: "Inspect the stopped run before continuing.",
  } as ExecutionBlocker;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });

  it("requires provider stop and records a verified outcome without exposing replay", async () => {
    vi.mocked(issuesApi.resolveRecoveryAction).mockResolvedValue({} as never);
    await act(async () => root.render(<QueryClientProvider client={client}>
      <ExecutionReconciliationPanel issueId="issue-1" issueStatus="todo"
        blocker={blocker} action={action} onResolved={onResolved} />
    </QueryClientProvider>));

    expect(container.textContent).toContain("The previous execution will not be replayed");
    expect(container.textContent).not.toContain("Replay");
    const submit = container.querySelector<HTMLButtonElement>("[data-testid=execution-reconciliation-submit]")!;
    expect(submit.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
      const evidence = container.querySelector<HTMLTextAreaElement>("textarea")!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setValue.call(evidence, "Verified the provider stopped and no pending external action remains.");
      evidence.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "evidence" }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());

    expect(issuesApi.resolveRecoveryAction).toHaveBeenCalledWith("issue-1", expect.objectContaining({
      actionId: "recovery-1",
      outcome: "restored",
      sourceIssueStatus: "todo",
      executionReconciliation: {
        runId: "run-1",
        providerStopped: true,
        actionOutcome: "not_performed",
        outcomeEvidence: "Verified the provider stopped and no pending external action remains.",
      },
    }));
    expect(onResolved).toHaveBeenCalled();
  });
});
