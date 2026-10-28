import { describe, expect, it } from "vitest";
import {
  normalizePilibalaOperationalSkillPreference,
  normalizePilibalaRunnerAdapterConfig,
  PILIBALA_OPERATIONAL_SKILL_KEY,
  resolveLegacyPilibalaDesiredSkillNames,
} from "@pilibalaai/adapter-utils/server-utils";

const legacyConfig = {
  pilibalaSkillSync: {
    desiredSkills: [PILIBALA_OPERATIONAL_SKILL_KEY],
  },
};

describe("pilibala_runner operational skill normalization", () => {
  it("applies full-auto native runner defaults at persistence boundaries", () => {
    expect(normalizePilibalaRunnerAdapterConfig("pilibala_runner", {})).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      codexPermissionMode: "never",
      lifecycleMode: "per_turn",
    });
  });

  it("repairs an existing blank model without replacing an explicit model", () => {
    expect(normalizePilibalaRunnerAdapterConfig("pilibala_runner", { model: "" }))
      .toMatchObject({ model: "gpt-5.6-sol" });
    expect(normalizePilibalaRunnerAdapterConfig("pilibala_runner", { model: "gpt-5.5" }))
      .toMatchObject({ model: "gpt-5.5" });
  });

  it("does not replace a non-Codex provider model with the Codex default", () => {
    expect(normalizePilibalaRunnerAdapterConfig("pilibala_runner", {
      provider: "claude_managed",
      model: "claude-sonnet-5",
    })).toMatchObject({
      provider: "claude_managed",
      model: "claude-sonnet-5",
    });
  });

  it("removes the legacy operational skill while preserving optional skills", () => {
    const normalized = normalizePilibalaOperationalSkillPreference("pilibala_runner", {
      pilibalaSkillSync: {
        desiredSkills: [PILIBALA_OPERATIONAL_SKILL_KEY, "company-1/reviewer"],
      },
    });

    expect(normalized).toEqual({
      pilibalaSkillSync: { desiredSkills: ["company-1/reviewer"] },
    });
  });

  it("restores the required operational skill through the legacy resolver after switching back", () => {
    const normalized = normalizePilibalaOperationalSkillPreference("pilibala_runner", legacyConfig);
    expect(resolveLegacyPilibalaDesiredSkillNames(normalized, [{
      key: PILIBALA_OPERATIONAL_SKILL_KEY,
      runtimeName: "pilibala",
    }])).toEqual([PILIBALA_OPERATIONAL_SKILL_KEY]);
  });

  it("does not change direct adapter preferences", () => {
    expect(normalizePilibalaOperationalSkillPreference("codex_local", legacyConfig)).toBe(legacyConfig);
  });
});
