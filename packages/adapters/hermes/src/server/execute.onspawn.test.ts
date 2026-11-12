/**
 * Regression test for onSpawn forwarding in the hermes-local adapter.
 *
 * Ensures ctx.onSpawn is forwarded to runChildProcess() so the orphan
 * reaper can track live child processes by PID, preventing false-positive
 * reaps on runs whose updatedAt becomes stale.
 *
 * @see https://github.com/pilibalaai/pilibala/issues/8723
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the adapter-utils server-utils module that execute.ts imports from.
// We intercept runChildProcess so we can inspect its opts without spawning
// a real child process.
vi.mock("@pilibalaai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pilibalaai/adapter-utils/server-utils")>();
  return {
    ...actual,
    runChildProcess: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
    })),
  };
});

// Mock fs and path resolution to avoid real file reads in execute()
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
}));

import { execute } from "./execute.js";
import { DEFAULT_TIMEOUT_SEC, DEFAULT_GRACE_SEC } from "../shared/constants.js";
import * as serverUtils from "@pilibalaai/adapter-utils/server-utils";

function makeCtx(overrides: Record<string, unknown> = {}) {
  const onSpawn = vi.fn(async () => undefined);
  return {
    ctx: {
      runId: "test-run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        engine: "cli",
        command: "/usr/bin/hermes",
        timeoutSec: 60,
        graceSec: 5,
        ...overrides,
      },
      context: {
        issueId: "issue-1",
        wakeReason: "manual",
        pilibalaWake: null,
      },
      onLog: vi.fn(async () => undefined),
      onMeta: vi.fn(async () => undefined),
      onSpawn,
    } satisfies Record<string, unknown>,
    onSpawn,
  };
}

describe("hermes-local adapter onSpawn forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards ctx.onSpawn to runChildProcess", async () => {
    const { ctx, onSpawn } = makeCtx();

    // execute() will call runChildProcess internally.
    // We expect it to propagate ctx.onSpawn.
    // Because we mocked runChildProcess, the actual child doesn't spawn,
    // but we can verify it was called with onSpawn.
    try {
      await execute(ctx as any);
    } catch {
      // execute may fail due to missing hermes binary / env — that's OK,
      // we only care that runChildProcess was called with onSpawn.
    }

    const mocked = vi.mocked(serverUtils.runChildProcess);
    expect(mocked.mock.calls.length).toBeGreaterThan(0);
    const lastCall = mocked.mock.calls[mocked.mock.calls.length - 1];
    const opts = lastCall[3] as Record<string, unknown>;
    expect(opts.onSpawn).toBe(onSpawn);
  });

  it("keeps wake data in the prompt and drops configured JSON env copies", async () => {
    const { ctx } = makeCtx({ env: { PILIBALA_WAKE_PAYLOAD_JSON: "stale configured wake" } });
    const wake = { reason: "issue_assigned", issue: { id: "issue-1", description: "Current task brief" } };
    await execute({ ...ctx, context: { ...ctx.context, pilibalaWake: wake } } as any);
    const call = vi.mocked(serverUtils.runChildProcess).mock.calls.at(-1)!;
    expect(call[3].env).not.toHaveProperty("PILIBALA_WAKE_PAYLOAD_JSON");
    expect(call[2]).toContainEqual(expect.stringContaining("Current task brief"));
  });

  it("launches in the assigned task workspace when no cwd was configured", async () => {
    const { ctx } = makeCtx();
    await execute({ ...ctx, context: { ...ctx.context, pilibalaWorkspace: { cwd: "/private/qa/agent-workspace" } } } as any);
    expect(vi.mocked(serverUtils.runChildProcess).mock.calls.at(-1)![3].cwd).toBe("/private/qa/agent-workspace");
  });

  it("preserves an explicitly configured cwd", async () => {
    const { ctx } = makeCtx({ cwd: "/private/qa/configured-workspace" });
    await execute({ ...ctx, context: { ...ctx.context, pilibalaWorkspace: { cwd: "/private/qa/agent-workspace" } } } as any);
    expect(vi.mocked(serverUtils.runChildProcess).mock.calls.at(-1)![3].cwd).toBe("/private/qa/configured-workspace");
  });

  it("runChildProcess opts type includes onSpawn", () => {
    // Type-level assertion: if onSpawn were removed from the type,
    // this file would fail to compile. The runtime test above catches
    // the behavioral case; this documents the contract.
    const opts: Parameters<typeof serverUtils.runChildProcess>[3] = {
      cwd: "/tmp",
      env: {},
      timeoutSec: 60,
      graceSec: 5,
      onLog: async () => undefined,
      onSpawn: async () => undefined,
    };
    expect(opts.onSpawn).toBeDefined();
  });

  it("preserves a specific stderr diagnostic for a nonzero exit", async () => {
    vi.mocked(serverUtils.runChildProcess).mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Error: provider unavailable\n",
      pid: null,
      startedAt: null,
    });

    const { ctx } = makeCtx();
    const result = await execute(ctx as any);

    expect(result.errorMessage).toBe("Error: provider unavailable");
  });

  it("reports the exit code when a nonzero exit has no diagnostic", async () => {
    vi.mocked(serverUtils.runChildProcess).mockResolvedValueOnce({
      exitCode: 130,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      pid: null,
      startedAt: null,
    });

    const { ctx } = makeCtx();
    const result = await execute(ctx as any);

    expect(result.errorMessage).toBe("Hermes exited with code 130");
  });

  it("leaves timeout diagnostics to the heartbeat timeout path", async () => {
    vi.mocked(serverUtils.runChildProcess).mockResolvedValueOnce({
      exitCode: 143,
      signal: "SIGTERM",
      timedOut: true,
      stdout: "",
      stderr: "",
      pid: null,
      startedAt: null,
    });

    const { ctx } = makeCtx();
    const result = await execute(ctx as any);

    expect(result.errorMessage).toBeUndefined();
  });

  it("does not label signal cancellation as a silent nonzero exit", async () => {
    vi.mocked(serverUtils.runChildProcess).mockResolvedValueOnce({
      exitCode: null,
      signal: "SIGTERM",
      timedOut: false,
      stdout: "",
      stderr: "",
      pid: null,
      startedAt: null,
    });

    const { ctx } = makeCtx();
    const result = await execute(ctx as any);

    expect(result.errorMessage).toBeUndefined();
  });

  it("does not inherit PILIBALA_API_KEY without a harness token", async () => {
    const previousApiKey = process.env.PILIBALA_API_KEY;
    process.env.PILIBALA_API_KEY = "parent-process-key";

    try {
      const { ctx } = makeCtx();
      await execute(ctx as any);

      const mocked = vi.mocked(serverUtils.runChildProcess);
      const lastCall = mocked.mock.calls[mocked.mock.calls.length - 1];
      const opts = lastCall[3] as { env: Record<string, string> };
      expect(opts.env.PILIBALA_API_KEY).toBeUndefined();
    } finally {
      if (previousApiKey === undefined) delete process.env.PILIBALA_API_KEY;
      else process.env.PILIBALA_API_KEY = previousApiKey;
    }
  });
});

describe("hermes-local adapter config.pilibalaApiUrl env injection (AMB-267 / C5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function spawnedEnv(ctx: unknown): Record<string, string> {
    const mocked = vi.mocked(serverUtils.runChildProcess);
    expect(mocked.mock.calls.length).toBeGreaterThan(0);
    const opts = mocked.mock.calls[mocked.mock.calls.length - 1]![3] as Record<string, unknown>;
    return opts.env as Record<string, string>;
  }

  it("normalizes and injects the configured URL into the subprocess env", async () => {
    const { ctx } = makeCtx({ pilibalaApiUrl: "https://pilib.example.com" });
    try {
      await execute(ctx as any);
    } catch {
      // mocked runChildProcess resolves; unexpected throws are irrelevant here
    }
    expect(spawnedEnv(ctx).PILIBALA_API_URL).toBe("https://pilib.example.com/api");
  });

  it("wins over the server-derived env (config > adapter env > server env)", async () => {
    const previous = process.env.PILIBALA_API_URL;
    process.env.PILIBALA_API_URL = "http://127.0.0.1:9999/api";
    try {
      const { ctx } = makeCtx({ pilibalaApiUrl: "https://config-wins.example.com/api" });
      try {
        await execute(ctx as any);
      } catch {
        // ignore
      }
      expect(spawnedEnv(ctx).PILIBALA_API_URL).toBe("https://config-wins.example.com/api");
    } finally {
      if (previous === undefined) delete process.env.PILIBALA_API_URL;
      else process.env.PILIBALA_API_URL = previous;
    }
  });

  it("leaves the derived env untouched when no config URL is set", async () => {
    const { ctx } = makeCtx();
    try {
      await execute(ctx as any);
    } catch {
      // ignore
    }
    const env = spawnedEnv(ctx);
    // buildPilibalaEnv still derives the base URL from the agent identity.
    expect(env.PILIBALA_API_URL).not.toBe("https://config-wins.example.com/api");
  });
});

describe("hermes-local adapter timeout semantics (AMB-268 / C6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function spawnedOpts(ctx: unknown): Record<string, unknown> {
    const mocked = vi.mocked(serverUtils.runChildProcess);
    expect(mocked.mock.calls.length).toBeGreaterThan(0);
    return mocked.mock.calls[mocked.mock.calls.length - 1]![3] as Record<string, unknown>;
  }

  async function runWith(configOverride: Record<string, unknown>) {
    const { ctx } = makeCtx(configOverride);
    try {
      await execute(ctx as any);
    } catch {
      // mocked runChildProcess resolves; unrelated throws don't matter here
    }
    return spawnedOpts(ctx);
  }

  it("uses the configured positive timeout", async () => {
    const opts = await runWith({ timeoutSec: 120, graceSec: 7 });
    expect(opts.timeoutSec).toBe(120);
    expect(opts.graceSec).toBe(7);
  });

  it("treats 0 (schema-untouched default) as the lane default, not 'no timeout'", async () => {
    const opts = await runWith({ timeoutSec: 0 });
    expect(opts.timeoutSec).toBe(DEFAULT_TIMEOUT_SEC);
  });

  it("treats a negative timeoutSec as the explicit no-timeout opt-out (never arms a timer)", async () => {
    const opts = await runWith({ timeoutSec: -5, graceSec: -3 });
    expect(opts.timeoutSec).toBe(0);
    expect(opts.graceSec).toBe(DEFAULT_GRACE_SEC);
  });

  it("falls back to the lane default when unset", async () => {
    const { ctx } = makeCtx();
    delete (ctx.config as Record<string, unknown>).timeoutSec;
    delete (ctx.config as Record<string, unknown>).graceSec;
    try {
      await execute(ctx as any);
    } catch {
      // ignore
    }
    const opts = spawnedOpts(ctx);
    expect(opts.timeoutSec).toBe(DEFAULT_TIMEOUT_SEC);
    expect(opts.graceSec).toBe(DEFAULT_GRACE_SEC);
  });
});
