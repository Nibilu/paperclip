/**
 * E2E proof: the Hermes adapter's ACP lane drives the real hermes-acp server
 * through the shared acpx engine. Uses the engine's own session-params
 * fingerprint seam via the adapter config mapping — no mocks.
 *
 * Run: pnpm --filter @pilibalaai/hermes-pilibala-adapter exec \
 *        vitest run src/server/acp.e2e.test.ts
 */
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { buildHermesAcpConfig, createHermesAcpExecutor } from "./acp.js";

const timeoutSec = Number(process.env.HERMES_ACP_E2E ?? "0") > 0 ? 240 : 0;

describe.skipIf(!timeoutSec)("hermes acp e2e (HERMES_ACP_E2E=1)", () => {
  it("completes a real turn against the installed hermes-acp server", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-acp-e2e-"));
    const events: Array<{ type: string; payload: unknown }> = [];
    const executeHermesAcp = createHermesAcpExecutor();
    const result = await executeHermesAcp({
      config: buildHermesAcpConfig({
        engine: "acp",
        // Persistent matches the production default (DEFAULT_ACP_ENGINE_MODE):
        // the ACP client is kept open between ensureSession and the turn, so
        // the prompt targets the session that was just created. ("oneshot"
        // would exercise hermes's resume path, which currently fails on a
        // never-prompted session — see the known-issue note in acp.ts.)
        mode: "persistent",
      }),
      runId: `hermes-acp-e2e-${Date.now()}`,
      agent: { id: "e2e-agent", companyId: "e2e-company", name: "E2E Hermes" } as never,
      runtime: { taskKey: "e2e" } as never,
      context: {
        wakeReason: "e2e_proof",
        pilibalaWake: { version: 1, kind: "e2e_proof" },
        // A trivial deterministic instruction: the model must echo a fixed
        // marker so the assertion is content-based, not just exit-code-based.
        taskTitle: "E2E echo proof",
        taskBody: 'Reply with exactly the single token PILIBALA_E2E_OK and nothing else. Do not use tools.',
      },
      cwd,
      timeoutSec,
      onLog: (stream: string, chunk: string) => {
        if (process.env.HERMES_ACP_E2E_VERBOSE) process.stderr.write(`[${stream}] ${chunk}`);
      },
      onEvent: (event: never) => {
        events.push(event as { type: string; payload: unknown });
      },
    } as never);

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    const summary = String(result.summary ?? "");
    expect(summary.length).toBeGreaterThan(0);
    // Content assertion proves the model actually answered through the
    // shared engine's prompt path (not merely that the process exited).
    expect(summary).toContain("PILIBALA_E2E_OK");
    // Session params must record acpx identity for cross-run resume.
    const params = (result.resultJson as Record<string, unknown> | undefined)?.sessionParams
      ?? (result as unknown as { sessionParams?: Record<string, unknown> }).sessionParams;
    if (params) {
      const record = params as Record<string, unknown>;
      expect(record.acpSessionId ?? record.agentSessionId).toBeTruthy();
    }
  }, 300_000);
});
