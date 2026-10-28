<!-- GENERATED FILE — DO NOT EDIT. Run pnpm generate:capability-inventory. -->

# Capability Capability Contract

This generated contract is a self-contained derivative of the Pilibala skill, its seven references, the Pilibala Evals corpus, and the legacy MCP tool surface. It does not import or contact the Pilibala control plane.

The skill/reference inventory and eval cases are the only normative behavior sources. Pilibala does not use the legacy MCP calls as a production capability surface; all MCP names below are traceability aliases folded into normative eval rows. Their disposition, grants, assertions, and evidence contract are inherited from the target row rather than classified independently.

## Baseline Counts

- Skill/reference headings: 164
- Eval cases: 106 across 16 groups
- Total normative rows: 270
- Legacy MCP aliases folded into normative rows: 42

| Eval group | Cases |
| --- | ---: |
| hb | 5 |
| co | 6 |
| st | 8 |
| cm | 6 |
| se | 4 |
| su | 4 |
| bl | 5 |
| dp | 3 |
| ix | 9 |
| ap | 6 |
| ar | 4 |
| er | 9 |
| rf | 22 |
| mh | 4 |
| rs | 3 |
| wk | 8 |

## Regeneration

- `pnpm --dir packages/pilibala-runner generate:capability-inventory` imports the canonical baselines and rewrites every generated file.
- `pnpm --dir packages/pilibala-runner check:capability-inventory` validates counts, uniqueness, normative dispositions, one-to-one MCP folds, required fields, and generated-file drift without requiring the external eval repository.

## Skill / Reference Rows

| Capability | Primary disposition | Source anchor |
| --- | --- | --- |
| skill:skills/pilibala/SKILL.md:pilibala-skill:10 | optional_agent_tool | skills/pilibala/SKILL.md:10 |
| skill:skills/pilibala/SKILL.md:terminology:14 | optional_agent_tool | skills/pilibala/SKILL.md:14 |
| skill:skills/pilibala/SKILL.md:authentication:20 | control_plane_owned | skills/pilibala/SKILL.md:20 |
| skill:skills/pilibala/SKILL.md:conversation-tasks:32 | optional_agent_tool | skills/pilibala/SKILL.md:32 |
| skill:skills/pilibala/SKILL.md:server-verified-external-chat-turns:49 | control_plane_owned | skills/pilibala/SKILL.md:49 |
| skill:skills/pilibala/SKILL.md:the-heartbeat-procedure:89 | optional_agent_tool | skills/pilibala/SKILL.md:89 |
| skill:skills/pilibala/SKILL.md:generated-artifacts-and-work-products:200 | always_agent_tool | skills/pilibala/SKILL.md:200 |
| skill:skills/pilibala/SKILL.md:status-quick-guide:248 | control_plane_owned | skills/pilibala/SKILL.md:248 |
| skill:skills/pilibala/SKILL.md:monitors-and-watchers-say-only-what-you-actually-scheduled:258 | optional_agent_tool | skills/pilibala/SKILL.md:258 |
| skill:skills/pilibala/SKILL.md:delegating-review-tasks:271 | always_agent_tool | skills/pilibala/SKILL.md:271 |
| skill:skills/pilibala/SKILL.md:managing-a-user-s-inbox:282 | control_plane_owned | skills/pilibala/SKILL.md:282 |
| skill:skills/pilibala/SKILL.md:issue-dependencies-blockers:290 | control_plane_owned | skills/pilibala/SKILL.md:290 |
| skill:skills/pilibala/SKILL.md:requesting-board-approval:315 | optional_agent_tool | skills/pilibala/SKILL.md:315 |
| skill:skills/pilibala/SKILL.md:issue-thread-interactions:336 | optional_agent_tool | skills/pilibala/SKILL.md:336 |
| skill:skills/pilibala/SKILL.md:standalone-decisions:366 | optional_agent_tool | skills/pilibala/SKILL.md:366 |
| skill:skills/pilibala/SKILL.md:mcp-tool-approval-gates:470 | optional_agent_tool | skills/pilibala/SKILL.md:470 |
| skill:skills/pilibala/SKILL.md:niche-workflow-pointers:512 | optional_agent_tool | skills/pilibala/SKILL.md:512 |
| skill:skills/pilibala/SKILL.md:cases:522 | optional_agent_tool | skills/pilibala/SKILL.md:522 |
| skill:skills/pilibala/SKILL.md:company-skills-workflow:527 | optional_agent_tool | skills/pilibala/SKILL.md:527 |
| skill:skills/pilibala/SKILL.md:routines:538 | optional_agent_tool | skills/pilibala/SKILL.md:538 |
| skill:skills/pilibala/SKILL.md:task-files-and-workspace-choices:549 | optional_agent_tool | skills/pilibala/SKILL.md:549 |
| skill:skills/pilibala/SKILL.md:issue-workspace-runtime-controls:555 | optional_agent_tool | skills/pilibala/SKILL.md:555 |
| skill:skills/pilibala/SKILL.md:proposing-credentials-safely:562 | optional_agent_tool | skills/pilibala/SKILL.md:562 |
| skill:skills/pilibala/SKILL.md:reading-granted-secrets:569 | optional_agent_tool | skills/pilibala/SKILL.md:569 |
| skill:skills/pilibala/SKILL.md:critical-rules:595 | optional_agent_tool | skills/pilibala/SKILL.md:595 |
| skill:skills/pilibala/SKILL.md:comment-style-required:616 | always_agent_tool | skills/pilibala/SKILL.md:616 |
| skill:skills/pilibala/SKILL.md:update:648 | optional_agent_tool | skills/pilibala/SKILL.md:648 |
| skill:skills/pilibala/SKILL.md:task-documents-and-deliverables:658 | always_agent_tool | skills/pilibala/SKILL.md:658 |
| skill:skills/pilibala/SKILL.md:planning-required-when-planning-requested:672 | optional_agent_tool | skills/pilibala/SKILL.md:672 |
| skill:skills/pilibala/SKILL.md:key-endpoints-hot-routes:703 | optional_agent_tool | skills/pilibala/SKILL.md:703 |
| skill:skills/pilibala/SKILL.md:searching-issues:733 | optional_agent_tool | skills/pilibala/SKILL.md:733 |
| skill:skills/pilibala/SKILL.md:full-reference:743 | optional_agent_tool | skills/pilibala/SKILL.md:743 |
| skill:skills/pilibala/SKILL.md:conversational-confirmation-answers:747 | always_agent_tool | skills/pilibala/SKILL.md:747 |
| skill:skills/pilibala/SKILL.md:incidental-feedback:764 | optional_agent_tool | skills/pilibala/SKILL.md:764 |
| skill:skills/pilibala/references/api-reference.md:pilibala-api-reference:1 | optional_agent_tool | skills/pilibala/references/api-reference.md:1 |
| skill:skills/pilibala/references/api-reference.md:response-schemas:9 | optional_agent_tool | skills/pilibala/references/api-reference.md:9 |
| skill:skills/pilibala/references/api-reference.md:agent-record-get-api-agents-me-or-get-api-agents-agentid:11 | optional_agent_tool | skills/pilibala/references/api-reference.md:11 |
| skill:skills/pilibala/references/api-reference.md:company-portability:44 | optional_agent_tool | skills/pilibala/references/api-reference.md:44 |
| skill:skills/pilibala/references/api-reference.md:issue-with-ancestors-get-api-issues-issueid:116 | optional_agent_tool | skills/pilibala/references/api-reference.md:116 |
| skill:skills/pilibala/references/api-reference.md:issue-update-response-patch-api-issues-issueid:202 | optional_agent_tool | skills/pilibala/references/api-reference.md:202 |
| skill:skills/pilibala/references/api-reference.md:blocker-diagnostics-get-api-issues-issueid-diagnostics-blockers:244 | control_plane_owned | skills/pilibala/references/api-reference.md:244 |
| skill:skills/pilibala/references/api-reference.md:wake-diagnostics-get-api-issues-issueid-diagnostics-wakes:283 | control_plane_owned | skills/pilibala/references/api-reference.md:283 |
| skill:skills/pilibala/references/api-reference.md:subtree-diagnostics-get-api-issues-issueid-diagnostics-subtree:327 | optional_agent_tool | skills/pilibala/references/api-reference.md:327 |
| skill:skills/pilibala/references/api-reference.md:execution-policy-fields-on-an-issue:375 | optional_agent_tool | skills/pilibala/references/api-reference.md:375 |
| skill:skills/pilibala/references/api-reference.md:cross-agent-review-gates:427 | always_agent_tool | skills/pilibala/references/api-reference.md:427 |
| skill:skills/pilibala/references/api-reference.md:worked-example-ic-heartbeat:460 | optional_agent_tool | skills/pilibala/references/api-reference.md:460 |
| skill:skills/pilibala/references/api-reference.md:1-identity-skip-if-already-in-context:465 | control_plane_owned | skills/pilibala/references/api-reference.md:465 |
| skill:skills/pilibala/references/api-reference.md:2-check-inbox:469 | control_plane_owned | skills/pilibala/references/api-reference.md:469 |
| skill:skills/pilibala/references/api-reference.md:3-already-have-issue-101-inprogress-highest-priority-continue-it:476 | optional_agent_tool | skills/pilibala/references/api-reference.md:476 |
| skill:skills/pilibala/references/api-reference.md:4-do-the-actual-work-write-code-run-tests:483 | optional_agent_tool | skills/pilibala/references/api-reference.md:483 |
| skill:skills/pilibala/references/api-reference.md:5-work-is-done-update-status-and-comment-in-one-call:485 | always_agent_tool | skills/pilibala/references/api-reference.md:485 |
| skill:skills/pilibala/references/api-reference.md:6-still-have-time-checkout-the-next-task:489 | control_plane_owned | skills/pilibala/references/api-reference.md:489 |
| skill:skills/pilibala/references/api-reference.md:7-made-partial-progress-not-done-yet-comment-and-exit:496 | always_agent_tool | skills/pilibala/references/api-reference.md:496 |
| skill:skills/pilibala/references/api-reference.md:worked-example-report-a-board-user-s-mine-inbox:501 | control_plane_owned | skills/pilibala/references/api-reference.md:501 |
| skill:skills/pilibala/references/api-reference.md:board-user-created-the-requesting-issue:506 | optional_agent_tool | skills/pilibala/references/api-reference.md:506 |
| skill:skills/pilibala/references/api-reference.md:fetch-the-board-user-s-mine-inbox-issues:510 | control_plane_owned | skills/pilibala/references/api-reference.md:510 |
| skill:skills/pilibala/references/api-reference.md:summarize-it-back-to-the-board-in-a-comment-or-document:524 | always_agent_tool | skills/pilibala/references/api-reference.md:524 |
| skill:skills/pilibala/references/api-reference.md:worked-example-archive-a-resolved-inbox-item:529 | control_plane_owned | skills/pilibala/references/api-reference.md:529 |
| skill:skills/pilibala/references/api-reference.md:the-responsible-user-s-id-is-resolved-from-the-authenticated-agent-run:534 | optional_agent_tool | skills/pilibala/references/api-reference.md:534 |
| skill:skills/pilibala/references/api-reference.md:reverse-the-archive-if-it-was-premature-or-no-longer-desired:543 | optional_agent_tool | skills/pilibala/references/api-reference.md:543 |
| skill:skills/pilibala/references/api-reference.md:worked-example-reviewer-approver-heartbeat:553 | always_agent_tool | skills/pilibala/references/api-reference.md:553 |
| skill:skills/pilibala/references/api-reference.md:worked-example-manager-heartbeat:592 | optional_agent_tool | skills/pilibala/references/api-reference.md:592 |
| skill:skills/pilibala/references/api-reference.md:1-identity-skip-if-already-in-context:595 | control_plane_owned | skills/pilibala/references/api-reference.md:595 |
| skill:skills/pilibala/references/api-reference.md:2-check-team-status:599 | optional_agent_tool | skills/pilibala/references/api-reference.md:599 |
| skill:skills/pilibala/references/api-reference.md:3-agent-42-is-blocked-read-comments:606 | control_plane_owned | skills/pilibala/references/api-reference.md:606 |
| skill:skills/pilibala/references/api-reference.md:4-unblock-reassign-and-comment:610 | control_plane_owned | skills/pilibala/references/api-reference.md:610 |
| skill:skills/pilibala/references/api-reference.md:5-check-own-assignments:614 | optional_agent_tool | skills/pilibala/references/api-reference.md:614 |
| skill:skills/pilibala/references/api-reference.md:6-create-subtasks-and-delegate:621 | optional_agent_tool | skills/pilibala/references/api-reference.md:621 |
| skill:skills/pilibala/references/api-reference.md:load-tests-depend-on-caching-layer-being-done-first-pilibala-will-auto-wake-agent-55-when-the-blocker-resolves:627 | control_plane_owned | skills/pilibala/references/api-reference.md:627 |
| skill:skills/pilibala/references/api-reference.md:7-dashboard-for-health-check:632 | optional_agent_tool | skills/pilibala/references/api-reference.md:632 |
| skill:skills/pilibala/references/api-reference.md:comments-and-mentions:638 | always_agent_tool | skills/pilibala/references/api-reference.md:638 |
| skill:skills/pilibala/references/api-reference.md:update:645 | optional_agent_tool | skills/pilibala/references/api-reference.md:645 |
| skill:skills/pilibala/references/api-reference.md:cross-team-work-and-delegation:667 | optional_agent_tool | skills/pilibala/references/api-reference.md:667 |
| skill:skills/pilibala/references/api-reference.md:receiving-cross-team-work:671 | optional_agent_tool | skills/pilibala/references/api-reference.md:671 |
| skill:skills/pilibala/references/api-reference.md:questions-and-dependencies:681 | always_agent_tool | skills/pilibala/references/api-reference.md:681 |
| skill:skills/pilibala/references/api-reference.md:company-context:693 | optional_agent_tool | skills/pilibala/references/api-reference.md:693 |
| skill:skills/pilibala/references/api-reference.md:company-branding-ceo-board:705 | optional_agent_tool | skills/pilibala/references/api-reference.md:705 |
| skill:skills/pilibala/references/api-reference.md:openclaw-invite-prompt-ceo:725 | optional_agent_tool | skills/pilibala/references/api-reference.md:725 |
| skill:skills/pilibala/references/api-reference.md:setting-agent-instructions-path:744 | optional_agent_tool | skills/pilibala/references/api-reference.md:744 |
| skill:skills/pilibala/references/api-reference.md:project-setup-create-workspace:777 | optional_agent_tool | skills/pilibala/references/api-reference.md:777 |
| skill:skills/pilibala/references/api-reference.md:option-a-one-call-create-with-workspace:801 | optional_agent_tool | skills/pilibala/references/api-reference.md:801 |
| skill:skills/pilibala/references/api-reference.md:option-b-two-calls-project-first-then-workspace:820 | optional_agent_tool | skills/pilibala/references/api-reference.md:820 |
| skill:skills/pilibala/references/api-reference.md:governance-and-approvals:849 | optional_agent_tool | skills/pilibala/references/api-reference.md:849 |
| skill:skills/pilibala/references/api-reference.md:requesting-a-hire-management-only:853 | optional_agent_tool | skills/pilibala/references/api-reference.md:853 |
| skill:skills/pilibala/references/api-reference.md:ceo-strategy-approval:918 | optional_agent_tool | skills/pilibala/references/api-reference.md:918 |
| skill:skills/pilibala/references/api-reference.md:questions-and-waiting-for-human-input:927 | always_agent_tool | skills/pilibala/references/api-reference.md:927 |
| skill:skills/pilibala/references/api-reference.md:issue-thread-confirmations:1031 | always_agent_tool | skills/pilibala/references/api-reference.md:1031 |
| skill:skills/pilibala/references/api-reference.md:conversational-confirmation-answers:1089 | always_agent_tool | skills/pilibala/references/api-reference.md:1089 |
| skill:skills/pilibala/references/api-reference.md:checkbox-confirmations:1095 | always_agent_tool | skills/pilibala/references/api-reference.md:1095 |
| skill:skills/pilibala/references/api-reference.md:item-verdict-requests:1210 | optional_agent_tool | skills/pilibala/references/api-reference.md:1210 |
| skill:skills/pilibala/references/api-reference.md:checking-approval-status:1320 | optional_agent_tool | skills/pilibala/references/api-reference.md:1320 |
| skill:skills/pilibala/references/api-reference.md:approval-follow-up-requesting-agent:1326 | always_agent_tool | skills/pilibala/references/api-reference.md:1326 |
| skill:skills/pilibala/references/api-reference.md:issue-lifecycle:1344 | always_agent_tool | skills/pilibala/references/api-reference.md:1344 |
| skill:skills/pilibala/references/api-reference.md:error-handling:1374 | control_plane_owned | skills/pilibala/references/api-reference.md:1374 |
| skill:skills/pilibala/references/api-reference.md:full-api-reference:1388 | optional_agent_tool | skills/pilibala/references/api-reference.md:1388 |
| skill:skills/pilibala/references/api-reference.md:agents:1390 | optional_agent_tool | skills/pilibala/references/api-reference.md:1390 |
| skill:skills/pilibala/references/api-reference.md:issues-tasks:1411 | optional_agent_tool | skills/pilibala/references/api-reference.md:1411 |
| skill:skills/pilibala/references/api-reference.md:companies-projects-goals:1452 | optional_agent_tool | skills/pilibala/references/api-reference.md:1452 |
| skill:skills/pilibala/references/api-reference.md:routines:1476 | optional_agent_tool | skills/pilibala/references/api-reference.md:1476 |
| skill:skills/pilibala/references/api-reference.md:approvals-costs-activity-dashboard:1492 | optional_agent_tool | skills/pilibala/references/api-reference.md:1492 |
| skill:skills/pilibala/references/api-reference.md:secrets:1514 | optional_agent_tool | skills/pilibala/references/api-reference.md:1514 |
| skill:skills/pilibala/references/api-reference.md:agent-secret-proposals:1527 | optional_agent_tool | skills/pilibala/references/api-reference.md:1527 |
| skill:skills/pilibala/references/api-reference.md:agent-secret-access:1627 | optional_agent_tool | skills/pilibala/references/api-reference.md:1627 |
| skill:skills/pilibala/references/api-reference.md:common-mistakes:1667 | optional_agent_tool | skills/pilibala/references/api-reference.md:1667 |
| skill:skills/pilibala/references/artifacts.md:generated-artifacts-and-work-products:1 | always_agent_tool | skills/pilibala/references/artifacts.md:1 |
| skill:skills/pilibala/references/artifacts.md:workspace-only-file-references:15 | optional_agent_tool | skills/pilibala/references/artifacts.md:15 |
| skill:skills/pilibala/references/cases.md:cases:1 | optional_agent_tool | skills/pilibala/references/cases.md:1 |
| skill:skills/pilibala/references/cases.md:core-model:12 | optional_agent_tool | skills/pilibala/references/cases.md:12 |
| skill:skills/pilibala/references/cases.md:upsert-semantics:29 | optional_agent_tool | skills/pilibala/references/cases.md:29 |
| skill:skills/pilibala/references/cases.md:read-and-search:67 | optional_agent_tool | skills/pilibala/references/cases.md:67 |
| skill:skills/pilibala/references/cases.md:documents:90 | always_agent_tool | skills/pilibala/references/cases.md:90 |
| skill:skills/pilibala/references/cases.md:fields:118 | optional_agent_tool | skills/pilibala/references/cases.md:118 |
| skill:skills/pilibala/references/cases.md:issue-links:151 | optional_agent_tool | skills/pilibala/references/cases.md:151 |
| skill:skills/pilibala/references/cases.md:child-cases:176 | optional_agent_tool | skills/pilibala/references/cases.md:176 |
| skill:skills/pilibala/references/cases.md:attachments:195 | optional_agent_tool | skills/pilibala/references/cases.md:195 |
| skill:skills/pilibala/references/cases.md:lifecycle:208 | optional_agent_tool | skills/pilibala/references/cases.md:208 |
| skill:skills/pilibala/references/cases.md:worked-blog-post-example:222 | optional_agent_tool | skills/pilibala/references/cases.md:222 |
| skill:skills/pilibala/references/company-skills.md:company-skills-workflow:1 | optional_agent_tool | skills/pilibala/references/company-skills.md:1 |
| skill:skills/pilibala/references/company-skills.md:what-exists:5 | optional_agent_tool | skills/pilibala/references/company-skills.md:5 |
| skill:skills/pilibala/references/company-skills.md:permission-model:22 | optional_agent_tool | skills/pilibala/references/company-skills.md:22 |
| skill:skills/pilibala/references/company-skills.md:core-endpoints:29 | optional_agent_tool | skills/pilibala/references/company-skills.md:29 |
| skill:skills/pilibala/references/company-skills.md:install-a-skill-into-the-company:65 | optional_agent_tool | skills/pilibala/references/company-skills.md:65 |
| skill:skills/pilibala/references/company-skills.md:app-shipped-catalog:75 | optional_agent_tool | skills/pilibala/references/company-skills.md:75 |
| skill:skills/pilibala/references/company-skills.md:external-source-import:101 | optional_agent_tool | skills/pilibala/references/company-skills.md:101 |
| skill:skills/pilibala/references/company-skills.md:source-types-in-order-of-preference:105 | optional_agent_tool | skills/pilibala/references/company-skills.md:105 |
| skill:skills/pilibala/references/company-skills.md:example-skills-sh-import-preferred:116 | optional_agent_tool | skills/pilibala/references/company-skills.md:116 |
| skill:skills/pilibala/references/company-skills.md:example-github-import:138 | optional_agent_tool | skills/pilibala/references/company-skills.md:138 |
| skill:skills/pilibala/references/company-skills.md:inspect-what-was-installed:164 | optional_agent_tool | skills/pilibala/references/company-skills.md:164 |
| skill:skills/pilibala/references/company-skills.md:assign-skills-to-an-existing-agent:181 | optional_agent_tool | skills/pilibala/references/company-skills.md:181 |
| skill:skills/pilibala/references/company-skills.md:include-skills-during-hire-or-create:216 | optional_agent_tool | skills/pilibala/references/company-skills.md:216 |
| skill:skills/pilibala/references/company-skills.md:notes:256 | optional_agent_tool | skills/pilibala/references/company-skills.md:256 |
| skill:skills/pilibala/references/issue-documents.md:issue-documents-through-the-api:1 | always_agent_tool | skills/pilibala/references/issue-documents.md:1 |
| skill:skills/pilibala/references/issue-documents.md:create-a-document:8 | always_agent_tool | skills/pilibala/references/issue-documents.md:8 |
| skill:skills/pilibala/references/issue-documents.md:update-or-resolve-an-unclear-write:49 | optional_agent_tool | skills/pilibala/references/issue-documents.md:49 |
| skill:skills/pilibala/references/issue-workspaces.md:issue-workspace-runtime-controls:1 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:1 |
| skill:skills/pilibala/references/issue-workspaces.md:discover-the-workspace:5 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:5 |
| skill:skills/pilibala/references/issue-workspaces.md:choose-files-and-repositories:23 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:23 |
| skill:skills/pilibala/references/issue-workspaces.md:control-services:37 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:37 |
| skill:skills/pilibala/references/issue-workspaces.md:start-all-configured-services-waits-for-configured-readiness-checks:42 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:42 |
| skill:skills/pilibala/references/issue-workspaces.md:restart-all-configured-services:50 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:50 |
| skill:skills/pilibala/references/issue-workspaces.md:stop-all-running-services:58 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:58 |
| skill:skills/pilibala/references/issue-workspaces.md:read-the-url:77 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:77 |
| skill:skills/pilibala/references/issue-workspaces.md:mcp-tools:86 | optional_agent_tool | skills/pilibala/references/issue-workspaces.md:86 |
| skill:skills/pilibala/references/routines.md:pilibala-routines:1 | optional_agent_tool | skills/pilibala/references/routines.md:1 |
| skill:skills/pilibala/references/routines.md:lifecycle:16 | optional_agent_tool | skills/pilibala/references/routines.md:16 |
| skill:skills/pilibala/references/routines.md:creating-a-routine:27 | optional_agent_tool | skills/pilibala/references/routines.md:27 |
| skill:skills/pilibala/references/routines.md:concurrency-policies:64 | optional_agent_tool | skills/pilibala/references/routines.md:64 |
| skill:skills/pilibala/references/routines.md:catch-up-policies:76 | optional_agent_tool | skills/pilibala/references/routines.md:76 |
| skill:skills/pilibala/references/routines.md:activity-gated-scheduled-runs:87 | optional_agent_tool | skills/pilibala/references/routines.md:87 |
| skill:skills/pilibala/references/routines.md:example-skip-quiet-nights:107 | optional_agent_tool | skills/pilibala/references/routines.md:107 |
| skill:skills/pilibala/references/routines.md:adding-triggers:126 | optional_agent_tool | skills/pilibala/references/routines.md:126 |
| skill:skills/pilibala/references/routines.md:schedule-cron:136 | optional_agent_tool | skills/pilibala/references/routines.md:136 |
| skill:skills/pilibala/references/routines.md:webhook:150 | optional_agent_tool | skills/pilibala/references/routines.md:150 |
| skill:skills/pilibala/references/routines.md:api-manual-only:167 | optional_agent_tool | skills/pilibala/references/routines.md:167 |
| skill:skills/pilibala/references/routines.md:updating-and-deleting-triggers:179 | optional_agent_tool | skills/pilibala/references/routines.md:179 |
| skill:skills/pilibala/references/routines.md:manual-run:196 | optional_agent_tool | skills/pilibala/references/routines.md:196 |
| skill:skills/pilibala/references/routines.md:updating-a-routine:212 | optional_agent_tool | skills/pilibala/references/routines.md:212 |
| skill:skills/pilibala/references/routines.md:reading-routines-and-runs:223 | optional_agent_tool | skills/pilibala/references/routines.md:223 |
| skill:skills/pilibala/references/workflows.md:pilibala-workflow-playbooks:1 | optional_agent_tool | skills/pilibala/references/workflows.md:1 |
| skill:skills/pilibala/references/workflows.md:project-setup-ceo-manager:7 | optional_agent_tool | skills/pilibala/references/workflows.md:7 |
| skill:skills/pilibala/references/workflows.md:openclaw-invite-ceo:22 | optional_agent_tool | skills/pilibala/references/workflows.md:22 |
| skill:skills/pilibala/references/workflows.md:setting-agent-instructions-path:50 | optional_agent_tool | skills/pilibala/references/workflows.md:50 |
| skill:skills/pilibala/references/workflows.md:company-import-export:79 | optional_agent_tool | skills/pilibala/references/workflows.md:79 |
| skill:skills/pilibala/references/workflows.md:self-test-playbook-app-level:106 | optional_agent_tool | skills/pilibala/references/workflows.md:106 |

## Legacy MCP Alias Index

This is a compatibility/traceability index, not a tool catalog. “Inherited disposition” is shown only to make the normative target easy to audit.

| Legacy MCP name | Folded into normative row | Inherited disposition | Source anchor |
| --- | --- | --- | --- |
| pilibalaMe | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:290 |
| pilibalaInboxLite | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:296 |
| pilibalaListAgents | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:302 |
| pilibalaListSkills | eval:rf-cskill-audit-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:308 |
| pilibalaGetAgent | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:314 |
| pilibalaListIssues | eval:se-q-filters-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:323 |
| pilibalaGetIssue | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:338 |
| pilibalaGetHeartbeatContext | eval:hb-context-01 | control_plane_owned | packages/mcp-server/src/tools.ts:344 |
| pilibalaListComments | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:353 |
| pilibalaGetComment | eval:hb-wake-comment-01 | control_plane_owned | packages/mcp-server/src/tools.ts:366 |
| pilibalaListIssueApprovals | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:373 |
| pilibalaListDocuments | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:379 |
| pilibalaGetDocument | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:385 |
| pilibalaListDocumentRevisions | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:392 |
| pilibalaListProjects | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:402 |
| pilibalaGetProject | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:408 |
| pilibalaGetIssueWorkspaceRuntime | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:417 |
| pilibalaControlIssueWorkspaceServices | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:423 |
| pilibalaWaitForIssueWorkspaceService | eval:rf-iws-target-restart-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:440 |
| pilibalaListGoals | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:466 |
| pilibalaGetGoal | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:472 |
| pilibalaListApprovals | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:478 |
| pilibalaCreateApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:487 |
| pilibalaGetApproval | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:496 |
| pilibalaGetApprovalIssues | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:502 |
| pilibalaListApprovalComments | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:508 |
| pilibalaCreateIssue | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:514 |
| pilibalaUpdateIssue | eval:st-done-comment-01 | always_agent_tool | packages/mcp-server/src/tools.ts:521 |
| pilibalaCheckoutIssue | eval:co-body-contract-01 | control_plane_owned | packages/mcp-server/src/tools.ts:528 |
| pilibalaReleaseIssue | eval:er-release-01 | control_plane_owned | packages/mcp-server/src/tools.ts:540 |
| pilibalaAddComment | eval:cm-multiline-01 | always_agent_tool | packages/mcp-server/src/tools.ts:546 |
| pilibalaSuggestTasks | eval:ix-suggest-tasks-01 | always_agent_tool | packages/mcp-server/src/tools.ts:553 |
| pilibalaAskUserQuestions | eval:ix-questions-01 | always_agent_tool | packages/mcp-server/src/tools.ts:565 |
| pilibalaRequestConfirmation | eval:ix-confirmation-plan-01 | always_agent_tool | packages/mcp-server/src/tools.ts:577 |
| pilibalaRequestCheckboxConfirmation | eval:ix-checkbox-01 | always_agent_tool | packages/mcp-server/src/tools.ts:589 |
| pilibalaUpsertIssueDocument | eval:dp-plan-doc-01 | always_agent_tool | packages/mcp-server/src/tools.ts:601 |
| pilibalaRestoreIssueDocumentRevision | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:612 |
| pilibalaLinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:627 |
| pilibalaUnlinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:636 |
| pilibalaApprovalDecision | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:646 |
| pilibalaAddApprovalComment | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:668 |
| pilibalaApiRequest | eval:rf-api-404-report-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:677 |
