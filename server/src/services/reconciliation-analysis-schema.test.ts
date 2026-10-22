import { describe, expect, it } from "vitest";
import { reconciliationAgentDraftSchema, FIX_OPTION_PERMISSION_REQUIREMENTS } from "./reconciliation-analysis.js";

const baseDraft = {
  actionId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  runId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
  agentDraft: {
    providerStopped: { value: true, evidence: ["run:r#seq:1"] },
    actionOutcome: { value: "not_performed" as const, confidence: 0.9, evidence: ["run:r#seq:2"] },
    evidenceSummary: "Timeline reconstruction with run event seq references, long enough.",
    operatorNote: "none",
  },
};

const validOption = (overrides: Record<string, unknown> = {}, id = "opt-1"): {
  id: string; title: string; revertible: boolean; revertSteps: string[];
  executionScope: "server_side"; verificationCriteria: string; recommended?: boolean;
  permissionRequirements?: string[];
} => ({
  id,
  title: `Option ${id}`,
  revertible: true,
  revertSteps: ["unset the flag", "restart the daemon"],
  executionScope: "server_side" as const,
  verificationCriteria: "A fresh run of the source issue completes a turn.",
  ...overrides,
});

describe("reconciliationAgentDraftSchema - legacy drafts stay valid (S5 back-compat)", () => {
  it("parses a pre-ladder diagnosis-only draft without fixProposal", () => {
    const parsed = reconciliationAgentDraftSchema.parse(baseDraft);
    expect(parsed.agentDraft.fixProposal).toBeUndefined();
  });
});

describe("reconciliationAgentDraftSchema - fixProposal (R4/S5)", () => {
  it("parses a proposal with one recommended revertible option", () => {
    const parsed = reconciliationAgentDraftSchema.parse({
      ...baseDraft,
      agentDraft: {
        ...baseDraft.agentDraft,
        fixProposal: {
          title: "Restore the ACP environment",
          rationale: "The managed environment lost the acp extra after the upgrade.",
          options: [validOption({ recommended: true, permissionRequirements: ["environment_install", "service_restart"] })],
        },
      },
    });
    expect(parsed.agentDraft.fixProposal?.options[0]?.permissionRequirements).toEqual(["environment_install", "service_restart"]);
  });

  it("rejects proposals without exactly one recommended option", () => {
    for (const recommendedCount of [0, 2]) {
      const options = [validOption({ recommended: true }, "a"), validOption({ recommended: true }, "b")];
      if (recommendedCount === 0) for (const option of options) option.recommended = false;
      expect(() => reconciliationAgentDraftSchema.parse({
        ...baseDraft,
        agentDraft: { ...baseDraft.agentDraft, fixProposal: { title: "t", rationale: "r", options } },
      })).toThrow();
    }
  });

  it("rejects revertible options without revertSteps and non-revertible options with them", () => {
    expect(() => reconciliationAgentDraftSchema.parse({
      ...baseDraft,
      agentDraft: { ...baseDraft.agentDraft, fixProposal: { title: "t", rationale: "r", options: [validOption({ revertible: true, revertSteps: [] })] } },
    })).toThrow();
    expect(() => reconciliationAgentDraftSchema.parse({
      ...baseDraft,
      agentDraft: { ...baseDraft.agentDraft, fixProposal: { title: "t", rationale: "r", options: [validOption({ revertible: false })] } },
    })).toThrow();
  });

  it("rejects unknown permission requirements and more than five options", () => {
    expect(FIX_OPTION_PERMISSION_REQUIREMENTS).not.toContain("anything_goes");
    expect(() => reconciliationAgentDraftSchema.parse({
      ...baseDraft,
      agentDraft: { ...baseDraft.agentDraft, fixProposal: { title: "t", rationale: "r", options: [validOption({ permissionRequirements: ["root_password"] })] } },
    })).toThrow();
    const six = Array.from({ length: 6 }, (_, i) => validOption({ recommended: i === 0 }, `o${i}`));
    expect(() => reconciliationAgentDraftSchema.parse({
      ...baseDraft,
      agentDraft: { ...baseDraft.agentDraft, fixProposal: { title: "t", rationale: "r", options: six } },
    })).toThrow();
  });

  it("keeps the recommendation reachable for the timeout adopter: recommended option carries verificationCriteria", () => {
    const parsed = reconciliationAgentDraftSchema.parse({
      ...baseDraft,
      agentDraft: {
        ...baseDraft.agentDraft,
        fixProposal: {
          title: "t",
          rationale: "r",
          options: [
            validOption({ recommended: true, revertible: false, revertSteps: [] }, "manual-only"),
            validOption({}, "safe"),
          ],
        },
      },
    });
    const recommended = parsed.agentDraft.fixProposal?.options.find((option) => option.recommended);
    expect(recommended?.verificationCriteria.length).toBeGreaterThan(0);
  });
});
