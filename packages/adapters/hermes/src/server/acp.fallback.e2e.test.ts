/**
 * E2E proof of the silent-session-loss fallback against the REAL hermes-acp.
 *
 * Scenario (the upstream defect): mode=oneshot forces a cross-process resume
 * on the FIRST turn. The fresh session was never prompted, so hermes never
 * persisted it; its session/resume silently fabricates a new session and the
 * prompt of the original id returns stop_reason=refusal with no message.
 * Without the fallback the run would fail with a poisoned persisted session.
 * With it, the run still reports the failure BUT clears session params, so
 * the next run bootstraps fresh instead of resuming the dead id.
 *
 * Run: HERMES_ACP_E2E=1 pnpm exec vitest run src/server/acp.e2e.test.ts
 * (this test lives in the same gated file's describe tree)
 */
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { buildHermesAcpConfig, createHermesAcpExecutor } from "./acp.js";

const timeoutSec = Number(process.env.HERMES_ACP_E2E ?? "0") > 0 ? 240 : 0;

describe.skipIf(!timeoutSec)("hermes acp silent-loss fallback e2e (HERMES_ACP_E2E=1)", () => {
  it("oneshot cross-process resume clears session params after a silent refusal", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-acp-fallback-"));
    const stderrLines: string[] = [];
    const executeHermesAcp = createHermesAcpExecutor();

    // Turn 1 (oneshot): session is created in ensureSession's process, then
    // closed; the turn's process resumes the unprompted session → silent
    // refusal. The fallback must fire and set clearSession on the result.
    const first = await executeHermesAcp({
      config: buildHermesAcpConfig({ engine: "acp", mode: "oneshot" }),
      runId: `hermes-acp-fallback-${Date.now()}`,
      agent: { id: "e2e-fallback", companyId: "e2e-company", name: "E2E Fallback" } as never,
      runtime: { taskKey: "e2e-fallback" } as never,
      context: {
        wakeReason: "e2e_fallback_proof",
        pilibalaWake: { version: 1, kind: "e2e_fallback_proof" },
        taskTitle: "E2E echo proof",
        taskBody: "Reply with exactly the single token PILIBALA_FALLBACK_OK and nothing else. Do not use tools.",
      },
      cwd,
      timeoutSec,
      onLog: (stream: string, chunk: string) => {
        if (stream === "stderr") stderrLines.push(chunk);
        if (process.env.HERMES_ACP_E2E_VERBOSE) process.stderr.write(`[${stream}] ${chunk}`);
      },
    } as never);

    // The defective lane still fails the run (the turn was lost), but the
    // result MUST carry clearSession so the next run bootstraps fresh.
    expect(first.clearSession).toBe(true);
    expect(
      stderrLines.join("").includes("silent refusal"),
      "expected the silent-refusal fallback log line",
    ).toBe(true);

    // Turn 2 with the same taskKey: session params were cleared upstream, so
    // this run starts a FRESH session (no resume) and the model actually
    // answers through the persistent keep-alive lane.
    const second = await executeHermesAcp({
      config: buildHermesAcpConfig({ engine: "acp", mode: "persistent" }),
      runId: `hermes-acp-fallback2-${Date.now()}`,
      agent: { id: "e2e-fallback", companyId: "e2e-company", name: "E2E Fallback" } as never,
      runtime: { taskKey: "e2e-fallback" } as never,
      context: {
        wakeReason: "e2e_fallback_proof",
        pilibalaWake: { version: 1, kind: "e2e_fallback_proof" },
        taskTitle: "E2E echo proof",
        taskBody: "Reply with exactly the single token PILIBALA_FALLBACK_OK and nothing else. Do not use tools.",
      },
      cwd,
      timeoutSec,
      onLog: (stream: string, chunk: string) => {
        if (process.env.HERMES_ACP_E2E_VERBOSE) process.stderr.write(`[${stream}] ${chunk}`);
      },
    } as never);
    expect(second.exitCode).toBe(0);
    expect(String(second.summary ?? "")).toContain("PILIBALA_FALLBACK_OK");
  }, 400_000);
});
