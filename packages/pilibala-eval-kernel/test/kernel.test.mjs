import assert from "node:assert/strict";
import test from "node:test";

import {
  PILIBALA_EVAL_KERNEL_COMPATIBILITY,
  PilibalaEvalKernelConfigurationError,
  runPilibalaEvalMatrix,
} from "../dist/index.js";

test("runs a caller-owned scenario/candidate matrix", async () => {
  const results = await runPilibalaEvalMatrix({
    scenarios: [{ id: "scenario-a", input: { value: 2 } }],
    candidates: [{ id: "candidate-a", config: { multiplier: 3 } }],
    execute: async ({ scenario, candidate }) => scenario.input.value * candidate.config.multiplier,
    score: ({ output }) => ({ passed: output === 6 }),
  });
  assert.equal(PILIBALA_EVAL_KERNEL_COMPATIBILITY.apiVersion, 1);
  assert.deepEqual(results, [{
    scenarioId: "scenario-a",
    candidateId: "candidate-a",
    output: 6,
    score: { passed: true },
  }]);
});

test("fails before execution when compatibility preflight fails", async () => {
  let executed = false;
  await assert.rejects(
    runPilibalaEvalMatrix({
      scenarios: [{ id: "scenario-a", input: null }],
      candidates: [{
        id: "candidate-a",
        config: null,
        preflight: () => { throw new Error("pilibala_runner_incompatible"); },
      }],
      execute: async () => { executed = true; },
      score: () => null,
    }),
    /pilibala_runner_incompatible/,
  );
  assert.equal(executed, false);
});

test("rejects duplicate scenario ids", async () => {
  await assert.rejects(
    runPilibalaEvalMatrix({
      scenarios: [{ id: "duplicate", input: 1 }, { id: "duplicate", input: 2 }],
      candidates: [{ id: "candidate-a", config: null }],
      execute: async () => null,
      score: () => null,
    }),
    PilibalaEvalKernelConfigurationError,
  );
});
