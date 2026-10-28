import { describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import {
  getOrCreatePilibalaReactRoot,
  type PilibalaReactRootHost,
} from "./react-root";

describe("getOrCreatePilibalaReactRoot", () => {
  it("reuses the existing root when the entry module runs again", () => {
    const host: PilibalaReactRootHost = {};
    const container = {} as Parameters<typeof getOrCreatePilibalaReactRoot>[1];
    const root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
    const createRoot = vi.fn(() => root);

    expect(getOrCreatePilibalaReactRoot(host, container, createRoot)).toBe(root);
    expect(getOrCreatePilibalaReactRoot(host, container, createRoot)).toBe(root);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
  });
});
