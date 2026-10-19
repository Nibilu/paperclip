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
  it("keeps an unverified provider stopped draft from enabling continuation", async () => {
    const draftAction = { ...action, agentDraft: {
      providerStopped: { value: false, evidence: ["run-1#seq:42 timeout only"] },
      actionOutcome: { value: "mixed" as const, confidence: 0.1, evidence: ["run-1#seq:40 partial receipt"] },
      evidenceSummary: "The provider outcome is unknown and needs external verification.", operatorNote: "Keep this hold.",
    } };
    await act(async () => root.render(<QueryClientProvider client={client}>
      <ExecutionReconciliationPanel issueId="issue-1" issueStatus="blocked"
        blocker={blocker} action={draftAction} onResolved={onResolved} />
    </QueryClientProvider>));
    for (const button of container.querySelectorAll<HTMLButtonElement>("[data-testid^=accept-draft-]")) {
      await act(async () => button.click());
    }
    expect(container.querySelector<HTMLButtonElement>("[data-testid=execution-reconciliation-submit]")!.disabled).toBe(true);
    expect(issuesApi.resolveRecoveryAction).not.toHaveBeenCalled();
  });

  it("submits the operator's edits after review without changing the resolve contract", async () => {
    vi.mocked(issuesApi.resolveRecoveryAction).mockResolvedValue({} as never);
    const draftAction = { ...action, agentDraft: {
      providerStopped: { value: false, evidence: ["run-1#seq:42 timeout"] },
      actionOutcome: { value: "mixed" as const, confidence: 0.4, evidence: ["run-1#seq:40 receipt"] },
      evidenceSummary: "Partial receipt; external verification is still required.", operatorNote: "Draft note",
    } };
    await act(async () => root.render(<QueryClientProvider client={client}>
      <ExecutionReconciliationPanel issueId="issue-1" issueStatus="blocked"
        blocker={blocker} action={draftAction} onResolved={onResolved} />
    </QueryClientProvider>));
    await act(async () => {
      container.querySelector<HTMLInputElement>("input")!.click();
      const select = container.querySelector<HTMLSelectElement>("select")!;
      select.value = "completed"; select.dispatchEvent(new Event("change", { bubbles: true }));
      const values = ["Operator verified the completed external receipt and provider shutdown.", "Verified by operator"];
      container.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((field, index) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, values[index]);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    const submit = container.querySelector<HTMLButtonElement>("[data-testid=execution-reconciliation-submit]")!;
    expect(submit.disabled).toBe(false);
    expect(issuesApi.resolveRecoveryAction).not.toHaveBeenCalled();
    await act(async () => submit.click());
    expect(issuesApi.resolveRecoveryAction).toHaveBeenCalledTimes(1);
    expect(issuesApi.resolveRecoveryAction).toHaveBeenCalledWith("issue-1", expect.objectContaining({
      resolutionNote: "Verified by operator", executionReconciliation: {
        runId: "run-1", providerStopped: true, actionOutcome: "completed",
        outcomeEvidence: "Operator verified the completed external receipt and provider shutdown.",
      },
    }));
  });

  it("prefills the draft but requires review of every field before human submission", async () => {
    const draftAction = { ...action, agentDraft: {
      providerStopped: { value: true, evidence: ["run-1#seq:385 stop receipt"] },
      actionOutcome: { value: "mixed" as const, confidence: 0.8, evidence: ["run-1#seq:240 deployment"] },
      evidenceSummary: "run-1#seq:240 deployment succeeded; seq:385 timed out during polling.",
      operatorNote: "Check the deployment receipt before continuing.",
    } };
    await act(async () => root.render(<QueryClientProvider client={client}>
      <ExecutionReconciliationPanel issueId="issue-1" issueStatus="blocked"
        blocker={blocker} action={draftAction} onResolved={onResolved} />
    </QueryClientProvider>));
    expect(container.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("mixed");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("deployment succeeded");
    const submit = container.querySelector<HTMLButtonElement>("[data-testid=execution-reconciliation-submit]")!;
    expect(submit.disabled).toBe(true);
    for (const field of ["providerStopped", "actionOutcome", "evidenceSummary", "operatorNote"]) {
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-testid=accept-draft-${field}]`)!.click());
    }
    expect(submit.disabled).toBe(false);
    expect(issuesApi.resolveRecoveryAction).not.toHaveBeenCalled();
  });

});
