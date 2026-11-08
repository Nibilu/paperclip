// @vitest-environment jsdom

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreadcrumbProvider, useBreadcrumbs } from "../context/BreadcrumbContext";
import { BreadcrumbBar } from "./BreadcrumbBar.production";

const viewport = vi.hoisted(() => ({ isMobile: false }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>{children}</a>
  ),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    collapsed: false,
    isMobile: viewport.isMobile,
    toggleCollapsed: vi.fn(),
    toggleSidebar: vi.fn(),
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { issuePrefix: "TES" } }),
}));

vi.mock("@/plugins/slots", () => ({
  usePluginSlots: () => ({ slots: [] }),
  PluginSlotOutlet: () => null,
}));

vi.mock("@/plugins/launchers", () => ({
  usePluginLaunchers: () => ({ launchers: [] }),
  PluginLauncherOutlet: () => null,
}));

function TaskBreadcrumbs({ onOpen }: { onOpen?: () => void }) {
  const { setBreadcrumbs, setBreadcrumbToolbar } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Tasks", href: "/issues" },
      {
        label: "Hire your first engineer and create a hiring plan",
        identifier: "TES-1",
      },
    ]);
    // IssueDetail hosts the side-panel reopen launcher here while the panel is
    // collapsed (AMB-130): the legacy bar must actually render this slot, or
    // the collapsed panel becomes unreachable.
    setBreadcrumbToolbar(
      onOpen ? (
        <button type="button" aria-label="Show task side panel" onClick={onOpen}>
          Show panel
        </button>
      ) : null,
    );
    return () => setBreadcrumbToolbar(null);
  }, [onOpen, setBreadcrumbToolbar, setBreadcrumbs]);

  return <BreadcrumbBar />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("BreadcrumbBar.production", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    viewport.isMobile = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // AMB-130 regression: the legacy shell's only panel toggle lives inside the
  // panel itself, so the breadcrumb-row launcher (rendered while the panel is
  // collapsed) is the only way back — it must not be dropped like the toolbar
  // slot used to be.
  it("renders the page toolbar (panel reopen launcher) in the legacy breadcrumb row", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <BreadcrumbProvider>
          <TaskBreadcrumbs onOpen={onOpen} />
        </BreadcrumbProvider>,
      );
    });

    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show task side panel"]',
    );
    expect(launcher).not.toBeNull();

    act(() => launcher?.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("keeps the page toolbar out of the mobile bar", async () => {
    viewport.isMobile = true;
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <BreadcrumbProvider>
          <TaskBreadcrumbs onOpen={onOpen} />
        </BreadcrumbProvider>,
      );
    });

    expect(
      container.querySelector('button[aria-label="Show task side panel"]'),
    ).toBeNull();
  });
});
