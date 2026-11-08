# Codex Constraints for Hermes Gateway Adapter Work

These instructions apply to `packages/adapters/hermes/` and its gateway integration.

## Scope

- Keep changes limited to Hermes Gateway adapter protocol support, capability negotiation, request timeouts/cancellation, remote-run identity, approval transport, error classification, and user-visible recovery diagnostics.
- Do not redesign Pilibala task status, scheduler, wake queue, lease model, or generic recovery state machine in this package.
- Do not add Hermes-specific task-state exceptions when an adapter-neutral contract is sufficient.

## Safety invariants

- Never replay an uncertain remote run automatically.
- Keep Pilibala run ID, Hermes remote run ID, approval request ID, and idempotency key distinct and traceable.
- A lost response is not proof that no remote run was created; reconcile with the original idempotency key.
- A stop request without verified acknowledgement is `outcome_unknown`, not success.
- Keep `API_SERVER_KEY` and `PILIBALA_API_KEY` in their correct directions; never print, commit, or inject credentials into prompts or logs.
- Approval choices must remain within the intersection of Gateway capability, Pilibala policy, and the current user grant. Do not expand `once` into `session` or `always`.

## Error contract

Use structured, stage-specific failures. At minimum distinguish:

- capability unsupported;
- authentication/authorization failure;
- provider quota;
- Gateway unavailable or timeout;
- remote run created but status unknown;
- stop acknowledged;
- stop outcome unknown;
- approval denied, expired, cancelled, or delivery failed.

Preserve the original cause, stage, remote-run-created fact, stop acknowledgement, and next action for Pilibala's control-plane projection. Do not replace these with a generic `failed` message.

## Implementation rules

- Prefer existing adapter utilities and shared contracts over new abstractions.
- Use bounded, cancellable requests for create/status/events/approval/stop.
- Make event and approval handling idempotent and safe under duplicate/late delivery.
- Keep provider-specific logic inside this adapter; expose narrow adapter-neutral facts to Pilibala.
- Add behavioral tests for success, timeout, disconnect, duplicate event, 401/403, 429, 5xx, lost response, stop acknowledgement, and unknown outcome.
- Add a real integration proof against a test Gateway where network/protocol behavior matters; mocks alone are insufficient.
- Run the smallest relevant Hermes adapter tests first, then package typecheck/build. Do not commit or create branches unless explicitly requested.

## Hindsight memory

When the Hindsight MCP is available to Codex, use it only for project-relevant prior decisions and failure history. Never store or retrieve credentials, tokens, passwords, or unredacted connection strings. Treat returned memories as context to verify against current source and runtime behavior, not as permission to change scope.
