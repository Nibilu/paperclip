import type { Db } from "@paperclipai/db";
import { heartbeatRuns } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishLiveEventMock } = vi.hoisted(() => ({
  publishLiveEventMock: vi.fn(),
}));

vi.mock("../live-events.js", () => ({
  publishLiveEvent: publishLiveEventMock,
}));

import {
  createHeartbeatRunOutput,
  LIVE_LOG_BATCH_FLUSH_INTERVAL_MS,
} from "./run-output.js";

type Recorder = ReturnType<typeof createHeartbeatRunOutput>;

const run = {
  id: "run-1",
  companyId: "company-1",
  agentId: "agent-1",
  status: "running",
  lastOutputSeq: 0,
  logBytes: 0,
} as unknown as typeof heartbeatRuns.$inferSelect;

function makeRecorder(): Recorder {
  // begin() writes the log ref back to the run row; a stub db is enough for
  // the batching behavior under test.
  const dbStub = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    })),
  } as unknown as Db;
  return createHeartbeatRunOutput(dbStub, {
    run,
    runId: "run-1",
    issueId: null,
    runLogStore: {
      begin: vi.fn(async () => ({ store: "local_file" as const, logRef: "log-1" })),
      append: vi.fn(async () => 10),
    },
    identityRedactor: {
      chunk: (_stream: "stdout" | "stderr", chunk: string) => chunk,
      redact: <T>(value: T) => value,
    },
    secretKeys: new Set<string>(),
    appendRunEvent: vi.fn(async () => {}),
    getCurrentUserRedactionOptions: vi.fn(async () => ({ enabled: false })),
  });
}

/** appendIdentityRedactedLog also emits heartbeat.run.progress; assert on log batches only. */
function logBatchCalls() {
  return publishLiveEventMock.mock.calls
    .map((call) => call[0] as { type: string; payload: Record<string, unknown> })
    .filter((event) => event.type === "heartbeat.run.log");
}

describe("heartbeat run output live-log batching", () => {
  beforeEach(() => {
    vi.useRealTimers();
    publishLiveEventMock.mockReset();
  });

  it("buffers rapid chunks into one broadcast and flushes on the interval", async () => {
    const recorder = makeRecorder();
    await recorder.begin(run);
    const handlers = await recorder.begin(run);
    publishLiveEventMock.mockClear();

    await handlers.appendIdentityRedactedLog("stdout", "chunk-1\n");
    await handlers.appendIdentityRedactedLog("stdout", "chunk-2\n");
    await handlers.appendIdentityRedactedLog("stderr", "err-1\n");
    // Nothing broadcast yet — the batching window is open.
    expect(logBatchCalls()).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, LIVE_LOG_BATCH_FLUSH_INTERVAL_MS + 50));

    const batches = logBatchCalls();
    expect(batches).toHaveLength(1);
    const payload = batches[0]!.payload as {
      chunks: Array<{ chunk: string; seq: number }>;
      chunk: string;
      seq: number;
    };
    expect(payload.chunks).toHaveLength(3);
    expect(payload.chunks.map((c) => c.chunk)).toEqual(["chunk-1\n", "chunk-2\n", "err-1\n"]);
    // Legacy fields carry the last chunk.
    expect(payload.chunk).toBe("err-1\n");
    expect(payload.seq).toBe(3);
  });

  it("flushes immediately when the batch reaches the size cap", async () => {
    const recorder = makeRecorder();
    await recorder.begin(run);
    const handlers = await recorder.begin(run);
    publishLiveEventMock.mockClear();

    // Each live chunk is tail-capped at MAX_LIVE_LOG_CHUNK_BYTES (8KB), so the
    // byte cap needs multiple chunks: 2 × 8KB = 16384 >= 16KB cap.
    const big = "x".repeat(8 * 1024);
    await handlers.appendIdentityRedactedLog("stdout", big);
    await handlers.appendIdentityRedactedLog("stdout", big);
    const batches = logBatchCalls();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.payload.chunks).toHaveLength(2);
  });

  it("emits buffered chunks when flushed at run completion", async () => {
    const recorder = makeRecorder();
    await recorder.begin(run);
    const handlers = await recorder.begin(run);
    publishLiveEventMock.mockClear();

    await handlers.appendIdentityRedactedLog("stdout", "final-chunk\n");
    expect(logBatchCalls()).toHaveLength(0);
    recorder.flushLiveLogBatch();
    expect(logBatchCalls()).toHaveLength(1);

    // A flush with an empty buffer publishes nothing.
    recorder.flushLiveLogBatch();
    expect(logBatchCalls()).toHaveLength(1);
  });
});
