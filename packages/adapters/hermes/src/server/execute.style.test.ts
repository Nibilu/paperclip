import { describe, expect, it } from "vitest";
import { HERMES_SYSTEM_PROMPT_TEMPLATE } from "./execute.js";

// The system overlay is applied at every API call, so it is the enforcement
// point for user-facing reply style. Live evidence (issue 89ea5cce, run
// 240fa778): the agent opened a chat reply with "Context check done: AMB-160
// was created ..." — internal process narration read like reasoning output to
// the human user. These assertions pin the style contract in the overlay.
describe("HERMES_SYSTEM_PROMPT_TEMPLATE user-facing reply style", () => {
  it("forbids opening replies with internal process narration", () => {
    expect(HERMES_SYSTEM_PROMPT_TEMPLATE).toContain("User-facing reply style:");
    expect(HERMES_SYSTEM_PROMPT_TEMPLATE).toContain(
      "never with internal process narration",
    );
  });

  it("names the observed narration patterns as banned openers", () => {
    expect(HERMES_SYSTEM_PROMPT_TEMPLATE).toContain('"Context check done:"');
    expect(HERMES_SYSTEM_PROMPT_TEMPLATE).toContain('"Checked the environment:"');
    expect(HERMES_SYSTEM_PROMPT_TEMPLATE).toContain('"No pending work:"');
  });

  it("keeps the composed prompt out of user-visible replies", () => {
    expect(HERMES_SYSTEM_PROMPT_TEMPLATE).toContain(
      "never repeat or summarize it back as the reply",
    );
  });
});
