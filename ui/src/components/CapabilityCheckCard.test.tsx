// @vitest-environment jsdom

import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilityCheckCard } from "./CapabilityCheckCard";
import type { AgentCapabilityObservation } from "@paperclipai/shared";

vi.mock("@/api/agents", () => ({
  agentsApi: {
    capabilityObservations: vi.fn(),
    capabilityCheck: vi.fn(),
    capabilityUpgradeTasks: vi.fn(),
    submitCapabilityUpgradeTask: vi.fn(),
    confirmCapabilityUpgradeTask: vi.fn(),
    list: vi.fn(),
  },
}));

import { agentsApi } from "@/api/agents";

function obs(overrides: Partial<AgentCapabilityObservation> = {}): AgentCapabilityObservation {
  return {
    id: "ca2f8516-05a5-41da-8330-1b518c3b0d17",
    companyId: "22bb83e2-4344-4a27-9f32-b853ce198a3e",
    agentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
    adapterType: "hermes_gateway",
    endpointLabel: "http://127.0.0.1:8642",
    revision: "unversioned",
    state: "available",
    operations: {
      create: { supported: true, endpoint: "POST /v1/runs" },
      status: { supported: true, endpoint: "GET /v1/runs/{run_id}" },
    },
    checkedAt: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

const mounted: Array<{ root: Root; host: HTMLElement }> = [];

function renderCard(props?: Partial<{ adapterType: string; agentId: string; companyId: string }>): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(host);
  flushSync(() => {
    root.render(
      <QueryClientProvider client={client}>
        <CapabilityCheckCard
          companyId="22bb83e2-4344-4a27-9f32-b853ce198a3e"
          agentId="132223e9-0ef0-45d8-887a-97442315a9a5"
          adapterType="hermes_gateway"
          {...props}
        />
      </QueryClientProvider>,
    );
  });
  mounted.push({ root, host });
  return host;
}

afterEach(() => {
  for (const { root, host } of mounted) {
    root.unmount();
    host.remove();
  }
  mounted.length = 0;
  vi.clearAllMocks();
});

describe("CapabilityCheckCard", () => {
  it("renders nothing for non-hermes_gateway adapters", () => {
    const host = renderCard({ adapterType: "process" });
    expect(host.textContent).toBe("");
  });

  it("shows the latest observation operations when available", async () => {
    vi.mocked(agentsApi.capabilityObservations).mockResolvedValue({ observations: [obs()] });
    const host = renderCard();
    await vi.waitFor(() => expect(host.textContent).toContain("available"));
    expect(host.textContent).toContain("http://127.0.0.1:8642");
    expect(host.textContent).toContain("POST /v1/runs");
  });

  it("shows a structured error state with next action", async () => {
    vi.mocked(agentsApi.capabilityObservations).mockResolvedValue({
      observations: [
        obs({
          state: "authentication_failed",
          error: {
            code: "hermes_gateway_capability_auth_failed",
            stage: "capability_check",
            message: "HTTP 401",
            nextAction: "Check adapterConfig.apiKey matches API_SERVER_KEY.",
          },
        }),
      ],
    });
    const host = renderCard();
    await vi.waitFor(() => expect(host.querySelector("[role=alert]")).toBeTruthy());
    expect(host.textContent).toContain("Check adapterConfig.apiKey matches API_SERVER_KEY.");
  });

  it("prompts for an upgrade task when the check found a gap", async () => {
    vi.mocked(agentsApi.capabilityObservations).mockResolvedValue({ observations: [obs()] });
    vi.mocked(agentsApi.capabilityCheck).mockResolvedValue({
      observation: obs(),
      diff: [{ kind: "added", scope: "operation", key: "steer" }],
      upgradeTaskRequired: true,
    });
    const host = renderCard();
    await vi.waitFor(() => expect(host.textContent).toContain("available"));
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Check again"));
    expect(button).toBeTruthy();
    button!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("upgrade task"));
    expect(host.textContent).toContain("steer");
  });
});

describe("CapabilityCheckCard upgrade tasks (HG-A5/A6/A7)", () => {
  function stubUpgradeDefaults() {
    vi.mocked(agentsApi.capabilityObservations).mockResolvedValue({ observations: [obs()] });
    vi.mocked(agentsApi.capabilityCheck).mockResolvedValue({
      observation: obs(),
      diff: [{ kind: "added", scope: "operation", key: "steer" }],
      upgradeTaskRequired: true,
    });
    vi.mocked(agentsApi.list).mockResolvedValue([
      { id: "aaaa4444-0000-4000-8000-000000000001", name: "Codex Dev" },
      { id: "aaaa4444-0000-4000-8000-000000000002", name: "Hermi" },
    ] as never);
    vi.mocked(agentsApi.capabilityUpgradeTasks).mockResolvedValue({ tasks: [] });
  }

  it("offers an agent picker and creates the upgrade task on submit", async () => {
    stubUpgradeDefaults();
    vi.mocked(agentsApi.submitCapabilityUpgradeTask).mockResolvedValue({
      issueId: "bbbb5555-0000-4000-8000-000000000001",
      identifier: "PAP-9",
      status: "todo",
      admissionGate: { reason: "capability_upgrade_awaiting_user_confirmation", confirmedAt: null },
    });
    const host = renderCard();
    await vi.waitFor(() => expect(host.textContent).toContain("available"));
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Check again"));
    button!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Select agent"));
    const picker = host.querySelector<HTMLSelectElement>("select[aria-label='Agent to perform the upgrade']");
    expect(picker).toBeTruthy();
    picker!.value = "aaaa4444-0000-4000-8000-000000000002";
    picker!.dispatchEvent(new Event("change", { bubbles: true }));
    const create = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Create upgrade task"));
    expect(create && !(create as HTMLButtonElement).disabled).toBe(true);
    create!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("PAP-9"));
    expect(host.textContent).toContain("waiting for your confirmation");
    expect(agentsApi.submitCapabilityUpgradeTask).toHaveBeenCalledWith(
      "132223e9-0ef0-45d8-887a-97442315a9a5",
      "22bb83e2-4344-4a27-9f32-b853ce198a3e",
      { upgradeAgentId: "aaaa4444-0000-4000-8000-000000000002", observationId: obs().id },
    );
  });

  it("lists upgrade tasks with traceability and a confirmation action", async () => {
    stubUpgradeDefaults();
    vi.mocked(agentsApi.capabilityUpgradeTasks).mockResolvedValue({
      tasks: [
        {
          issueId: "bbbb5555-0000-4000-8000-000000000002",
          identifier: "PAP-10",
          title: "Adapter capability upgrade",
          status: "todo",
          completedAt: null,
          createdAt: "2026-10-16T04:00:00.000Z",
          admissionGateConfirmedAt: null,
          provenance: {
            observationId: obs().id,
            sourceAgentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
            sourceAdapterType: "hermes_gateway",
            endpointLabel: "http://127.0.0.1:8642",
            capabilityRevision: "unversioned",
            protocolVersion: "0.21.1",
            diff: [{ kind: "added", scope: "operation", key: "steer" }],
            requestedByUserId: "user-1",
          },
        },
      ],
    });
    vi.mocked(agentsApi.confirmCapabilityUpgradeTask).mockResolvedValue({
      confirmed: true,
      confirmedAt: "2026-10-16T05:00:00.000Z",
    });
    const host = renderCard();
    await vi.waitFor(() => expect(host.textContent).toContain("PAP-10"));
    expect(host.textContent).toContain(`from check ${obs().id.slice(0, 8)}`);
    expect(host.textContent).not.toContain("verified by recheck");
    const confirm = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Confirm and schedule"));
    expect(confirm).toBeTruthy();
    confirm!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("confirmed"));
    expect(agentsApi.confirmCapabilityUpgradeTask).toHaveBeenCalledWith("bbbb5555-0000-4000-8000-000000000002");
  });

  it("marks an upgrade verified when a fresh check shows a moved revision", async () => {
    stubUpgradeDefaults();
    vi.mocked(agentsApi.capabilityObservations).mockResolvedValue({
      observations: [obs({ revision: "rev-2", id: "ca2f8516-05a5-41da-8330-1b518c3b0d99" })],
    });
    vi.mocked(agentsApi.capabilityUpgradeTasks).mockResolvedValue({
      tasks: [
        {
          issueId: "bbbb5555-0000-4000-8000-000000000003",
          identifier: "PAP-11",
          title: "Adapter capability upgrade",
          status: "done",
          completedAt: "2026-10-16T04:30:00.000Z",
          createdAt: "2026-10-16T04:00:00.000Z",
          admissionGateConfirmedAt: "2026-10-16T04:05:00.000Z",
          provenance: {
            observationId: obs().id,
            sourceAgentId: "132223e9-0ef0-45d8-887a-97442315a9a5",
            sourceAdapterType: "hermes_gateway",
            endpointLabel: "http://127.0.0.1:8642",
            capabilityRevision: "unversioned",
            protocolVersion: "0.21.1",
            diff: [{ kind: "added", scope: "operation", key: "steer" }],
            requestedByUserId: "user-1",
          },
        },
      ],
    });
    const host = renderCard();
    await vi.waitFor(() => expect(host.textContent).toContain("PAP-11"));
    await vi.waitFor(() => expect(host.textContent).toContain("verified by recheck"));
  });
});
