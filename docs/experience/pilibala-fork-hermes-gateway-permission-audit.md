# Pilibala Fork Hermes Gateway Permission Audit

- Recorded at: 2026-10-15T18:59:55+08:00
- Scope: Hermes Gateway adapter interface capabilities and exception handling only.
- User authorization: permission prompts required for repository edits, tests, builds, deployment verification, and Codex/Hindsight MCP integration are approved for this work.
- Audit rule: retain the permission scope for rollback and review; do not store credentials, tokens, API keys, cookies, or connection secrets.
- Implementation constraint: do not duplicate or rewrite Pilibala task status, scheduler, recovery state machine, or general control-plane work.
- Codex constraint: Hermes adapter work must follow `packages/adapters/hermes/AGENTS.md`.
- Hindsight status: Codex can call the local Hindsight MCP `retain` and `recall` tools. The retain operation was accepted asynchronously, but immediate readback did not return the record; this is not treated as verified Hindsight persistence.
