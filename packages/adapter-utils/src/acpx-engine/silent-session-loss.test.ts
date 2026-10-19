// Silent session-loss detector tests (Hermes ACP resume-fabrication fallback).
//
// The detector is the engine's defense against agents whose `session/resume`
// silently fabricates a fresh session instead of erroring: the resumed turn
// then answers with `stop_reason: "refusal"`, no streamed output, and no
// error, and without this fallback the poisoned session id would persist for
// every later run.

import { describe, expect, it } from "vitest";
import { isSilentSessionLossAfterResume } from "./execute.js";

describe("isSilentSessionLossAfterResume", () => {
  it("matches the exact silent-loss shape: resumed + refusal + no output + no error", () => {
    expect(isSilentSessionLossAfterResume({
      resumedSession: true,
      oneshot: false,
      stopReason: "refusal",
      hasOutputSegments: false,
      errorMessage: null,
    })).toBe(true);
  });

  it("matches a oneshot first run (structural cross-process boundary) with a silent refusal", () => {
    expect(isSilentSessionLossAfterResume({
      resumedSession: false,
      oneshot: true,
      stopReason: "refusal",
      hasOutputSegments: false,
      errorMessage: null,
    })).toBe(true);
  });

  it("does not fire for a fresh persistent session that refuses silently — that is the model's answer", () => {
    expect(isSilentSessionLossAfterResume({
      resumedSession: false,
      oneshot: false,
      stopReason: "refusal",
      hasOutputSegments: false,
      errorMessage: null,
    })).toBe(false);
  });

  it("matches case-insensitively and with surrounding whitespace", () => {
    expect(isSilentSessionLossAfterResume({
      resumedSession: true,
      oneshot: false,
      stopReason: " Refusal ",
      hasOutputSegments: false,
      errorMessage: "",
    })).toBe(true);
  });

  it("ignores a refusal that streamed an agent message — a real model refusal", () => {
    expect(isSilentSessionLossAfterResume({
      resumedSession: true,
      oneshot: false,
      stopReason: "refusal",
      hasOutputSegments: true,
      errorMessage: null,
    })).toBe(false);
  });

  it("ignores a refusal carrying an error message — the agent explained itself", () => {
    expect(isSilentSessionLossAfterResume({
      resumedSession: true,
      oneshot: false,
      stopReason: "refusal",
      hasOutputSegments: false,
      errorMessage: "Task rejected: out of scope.",
    })).toBe(false);
  });

  it("ignores non-refusal stop reasons", () => {
    for (const stopReason of ["end_turn", "cancelled", "max_tokens", null, undefined, ""]) {
      expect(isSilentSessionLossAfterResume({
        resumedSession: true,
        oneshot: true,
        stopReason,
        hasOutputSegments: false,
        errorMessage: null,
      })).toBe(false);
    }
  });
});
