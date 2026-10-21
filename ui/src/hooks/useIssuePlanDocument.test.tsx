// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIssuePlanDocument } from "./useIssuePlanDocument";

const { listDocumentsMock, getDocumentMock } = vi.hoisted(() => ({
  listDocumentsMock: vi.fn(),
  getDocumentMock: vi.fn(),
}));

vi.mock("@/api/issues", () => ({
  issuesApi: {
    listDocuments: listDocumentsMock,
    getDocument: getDocumentMock,
  },
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number) {
      super(`HTTP ${status}`);
    }
  },
}));

function renderHook(issueId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const captured: { data: unknown; fetchCount: number } = { data: undefined, fetchCount: 0 };
  function Harness() {
    const { data, isFetched } = useIssuePlanDocument(issueId);
    captured.data = data;
    if (isFetched) captured.fetchCount += 1;
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  };
  return { queryClient, captured, mount: () => act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )), unmount };
}

/** React Query commits query results on a macrotask in jsdom; microtask-only waits hang pending. */
async function flushQueries() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

const planDoc = { id: "doc-1", key: "plan", body: "# plan", latestRevisionId: "rev-1", latestRevisionNumber: 1 };
const otherDoc = { id: "doc-2", key: "report", body: "# report", latestRevisionId: "rev-2", latestRevisionNumber: 1 };

describe("useIssuePlanDocument (list-backed)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives the plan from a seeded list cache without any request", async () => {
    const { queryClient, captured, mount, unmount } = renderHook("issue-1");
    queryClient.setQueryData(["issues", "documents", "issue-1", "list"], [otherDoc, planDoc]);
    await mount();
    await flushQueries();

    expect(captured.data).toEqual(planDoc);
    expect(listDocumentsMock).not.toHaveBeenCalled();
    expect(getDocumentMock).not.toHaveBeenCalled();
    unmount();
  });

  it("fetches the documents list (not the 404-prone probe) when no cache exists, and seeds the shared list cache", async () => {
    listDocumentsMock.mockResolvedValue([planDoc, otherDoc]);
    const { queryClient, captured, mount, unmount } = renderHook("issue-2");
    await mount();
    await flushQueries();

    expect(listDocumentsMock).toHaveBeenCalledTimes(1);
    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(captured.data).toEqual(planDoc);
    // The response seeds the shared list cache for the other consumers.
    expect(queryClient.getQueryData(["issues", "documents", "issue-2", "list"])).toEqual([planDoc, otherDoc]);
    unmount();
  });

  it("returns null (no plan) without surfacing a 404", async () => {
    listDocumentsMock.mockResolvedValue([otherDoc]);
    const { captured, mount, unmount } = renderHook("issue-3");
    await mount();
    await flushQueries();

    expect(captured.data).toBeNull();
    expect(getDocumentMock).not.toHaveBeenCalled();
    unmount();
  });

  it("re-derives when a document invalidation lands a plan into the list cache", async () => {
    const { queryClient, captured, mount, unmount } = renderHook("issue-4");
    queryClient.setQueryData(["issues", "documents", "issue-4", "list"], [otherDoc]);
    await mount();
    await flushQueries();
    expect(captured.data).toBeNull();

    // The agent writes the plan mid-run; document-scope invalidation refreshes
    // the list and the plan appears without any single-doc probe.
    queryClient.setQueryData(["issues", "documents", "issue-4", "list"], [otherDoc, planDoc]);
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["issues", "documents", "issue-4"] }); });
    await flushQueries();

    expect(captured.data).toEqual(planDoc);
    expect(getDocumentMock).not.toHaveBeenCalled();
    unmount();
  });

  it("stays disabled for chat-pseudo issue ids", async () => {
    const { captured, mount, unmount } = renderHook("chat:abc");
    await mount();
    await act(async () => { await Promise.resolve(); });

    expect(captured.data).toBeUndefined();
    expect(listDocumentsMock).not.toHaveBeenCalled();
    unmount();
  });
});
