# Adapter timeout semantics per lane (0 / negative / unset)

Shared vocabulary: `timeoutSec` = adapter wall-clock timeout; `graceSec` =
seconds between SIGTERM and SIGKILL after a timeout fires.

| Lane | Unset / 0 | Positive | Negative |
|---|---|---|---|
| **ACP** (`adapter-utils` `resolveAdapterExecutionTargetTimeout`) | local/SSH target → no adapter timeout (unlimited); sandbox target → sandbox default | used as-is (fractional preserved) | explicit "no adapter wall-clock timeout" opt-out → 0 |
| **Hermes CLI** (`execute.ts` CLI path, aligned 2026-11) | lane default (DEFAULT_TIMEOUT_SEC, 1800) | used as-is | explicit no-timeout opt-out → 0 (never a timer) |
| **Hermes gateway** (`gateway/server/execute.ts`) | lane default | used as-is | clamped by runChildProcess; treated as not set |

Notes:
- Zero can never mean "no timeout" on persisted config: the adapter config UI
  persists the schema default (0 for untouched fields), so 0 carries no
  operator intent. Use a negative value to opt out of the wall clock.
- `graceSec` follows the same "positive = configured, otherwise default"
  rule on the CLI lane; a raw negative never reaches a timer (it used to
  clamp to a 1s kill window downstream).
- Sources: `packages/adapter-utils/src/execution-target.ts`
  (`resolveAdapterExecutionTargetTimeout`), `packages/adapters/hermes/src/
  server/execute.ts` (CLI lane resolution), runChildProcess timer arming
  (`timeoutSec > 0 ? setTimeout(...)`).
