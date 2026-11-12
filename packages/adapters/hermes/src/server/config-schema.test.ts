import { describe, expect, it } from "vitest";
import { getConfigSchema } from "./config-schema.js";

/**
 * Config-layer alignment from the AMB-254 follow-up (AMB-267 / C5):
 * - quiet defaults to false so non-quiet runs keep process logs (the quiet
 *   experience is the UI transcript filter's job);
 * - CLI-only switches are hidden on the acp engine where nothing consumes
 *   them (dead switches);
 * - pilibalaApiUrl's hint states what the value actually does.
 */
describe("hermes adapter config schema (AMB-267 / C5)", () => {
  const schema = getConfigSchema();
  const field = (key: string) => schema.fields.find((f) => f.key === key);

  it("defaults quiet to false", () => {
    expect(field("quiet")?.default).toBe(false);
  });

  it("marks persistSession/worktreeMode/checkpoints as CLI-engine-only", () => {
    for (const key of ["persistSession", "worktreeMode", "checkpoints"]) {
      expect(field(key)?.meta?.visibleWhen).toEqual({ key: "engine", values: ["cli"] });
    }
    // quiet/verbose stay visible on both engines (ACP uses quiet filtering).
    for (const key of ["quiet", "verbose"]) {
      expect(field(key)?.meta?.visibleWhen).toBeUndefined();
    }
  });

  it("describes the pilibalaApiUrl engine scope honestly", () => {
    const hint = String(field("pilibalaApiUrl")?.hint ?? "");
    expect(hint).toContain("ACP engine ignores it");
    expect(hint).not.toContain("Defaults to PILIBALA_API_URL.");
  });
});
