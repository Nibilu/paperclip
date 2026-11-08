// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveStreamlinedUiEnabled,
  useStreamlinedUiEnabled,
} from "./useStreamlinedUiEnabled";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

function Probe() {
  const state = useStreamlinedUiEnabled();
  return <output>{`${state.enabled}:${state.loaded}`}</output>;
}

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("useStreamlinedUiEnabled", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("fails open for missing settings and loading state", () => {
    expect(resolveStreamlinedUiEnabled(undefined)).toBe(true);
    expect(resolveStreamlinedUiEnabled(null)).toBe(true);

    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(host.textContent).toBe("true:false");
  });

  it("uses the legacy shell only for an explicit false value", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableStreamlinedUi: false });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(host.textContent).toBe("false:true");
    expect(resolveStreamlinedUiEnabled({ enableStreamlinedUi: true })).toBe(true);
    expect(resolveStreamlinedUiEnabled({ enableStreamlinedUi: false })).toBe(false);
  });

  it("fails open immediately on a terminal auth error (403 pre-auth)", async () => {
    // The boot gate runs pre-auth and the endpoint 403s by design; the gate
    // must not ride the default retry ladder (~7.5s) before mounting.
    mockInstanceSettingsApi.getExperimental.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    const queryClient = new QueryClient();
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(host.textContent).toBe("true:true");
    // The terminal error must not have been retried.
    expect(mockInstanceSettingsApi.getExperimental).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while the error is temporary (503)", async () => {
    mockInstanceSettingsApi.getExperimental.mockRejectedValue(
      Object.assign(new Error("unavailable"), { status: 503 }),
    );
    const queryClient = new QueryClient();
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Still loading — a temporary outage should retry, not fail open.
    expect(host.textContent).toBe("true:false");
  });
});
