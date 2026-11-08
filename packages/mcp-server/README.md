# Pilibala MCP Server

Model Context Protocol server for Pilibala.

This package is a thin MCP wrapper over the existing Pilibala REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PILIBALA_API_URL` - Pilibala base URL, for example `http://localhost:3100`
- `PILIBALA_API_KEY` - bearer token used for `/api` requests
- `PILIBALA_COMPANY_ID` - optional default company for company-scoped tools
- `PILIBALA_AGENT_ID` - optional default agent for checkout helpers
- `PILIBALA_RUN_ID` - optional run id forwarded on mutating requests

Inside an active heartbeat, Pilibala also injects `PILIBALA_RUNTIME_TOOLS_*` variables. They enable the run-scoped `connections_search` and `connection_request` tools and expire with the run.

## Usage

```sh
npx -y @pilibalaai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @pilibalaai/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Run-scoped connection tools:

- `connections_search`
- `connection_request`

Read tools:

- `pilibalaMe`
- `pilibalaInboxLite`
- `pilibalaListAgents`
- `pilibalaGetAgent`
- `pilibalaListIssues`
- `pilibalaGetIssue`
- `pilibalaGetHeartbeatContext`
- `pilibalaListComments`
- `pilibalaGetComment`
- `pilibalaListIssueApprovals`
- `pilibalaListDocuments`
- `pilibalaGetDocument`
- `pilibalaListDocumentRevisions`
- `pilibalaListProjects`
- `pilibalaGetProject`
- `pilibalaGetIssueWorkspaceRuntime`
- `pilibalaWaitForIssueWorkspaceService`
- `pilibalaListGoals`
- `pilibalaGetGoal`
- `pilibalaListApprovals`
- `pilibalaGetApproval`
- `pilibalaGetApprovalIssues`
- `pilibalaListApprovalComments`

Write tools:

- `pilibalaCreateIssue`
- `pilibalaUpdateIssue`
- `pilibalaCheckoutIssue`
- `pilibalaReleaseIssue`
- `pilibalaAddComment`
- `pilibalaSuggestTasks`
- `pilibalaAskUserQuestions`
- `pilibalaRequestConfirmation`
- `pilibalaUpsertIssueDocument`
- `pilibalaRestoreIssueDocumentRevision`
- `pilibalaControlIssueWorkspaceServices`
- `pilibalaCreateApproval`
- `pilibalaLinkIssueApproval`
- `pilibalaUnlinkIssueApproval`
- `pilibalaApprovalDecision`
- `pilibalaAddApprovalComment`

Escape hatch:

- `pilibalaApiRequest`

`pilibalaApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.
