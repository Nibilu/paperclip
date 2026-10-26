# AMB-102 · S8 回退入口测试 · 暂存与激活计划(2026-10-22)

Issue: **AMB-102 测试:S8 回退入口(API + 浏览器 E2E)**(dev 实例 :3104)
需求正本: AMB-98 plan(doc/plans/2026-10-22-recovery-ladder-requirements.md §4-R4/R6、§5-S8)。

## 0. 状态(2026-10-22 17:05 前置核查)

**阻塞:前置未满足。** S8 尚未实现、未合入 dev:

- `feature/recovery-ladder`(/home/amber/paperclip-recovery-ladder)仅有 S1–S5
  (f50845048..875f4e488:S1 分类器、S2 分类落库、S3 触发面、S4 医生选择+S5 提案 schema)。
- dev 主 checkout(/home/amber/paperclip,branch feature/hermes-setup-provider-flow)停在基线
  f50845048;:3104 `/api/health` 报 `commit: f50845048…` —— recovery-ladder 代码未部署。
- 全仓分支/工作树/stash 均无 S6/S7/S8 提交;worktree 内有他人在途改动(L2 invocation gate,
  reconciliation-analysis.ts,未提交)。
- 工具链已验证:ladder worktree `vitest run src/services/recovery/error-classification.test.ts`
  → 17/17 通过(node v22.17.1)。

## 1. 已固化的 S5 契约(S8 测试的输入)

`server/src/services/reconciliation-analysis.ts`(S5 已合入 worktree):

- `fixOption`: `id/title/description/recommended?/permissionRequirements[](environment_install,
  service_restart, adapter_config_change, session_rebind, workspace_repair, retry_only,
  manual_shell)/revertible:boolean/revertSteps:string[](revertible 必填、非 revertible 禁止)/
  executionScope(server_side|doctor_run|return_owner_run|manual)/verificationCriteria`。
- `fixProposal`: `title/rationale/options[1..5]`,恰好一个 `recommended:true`。
- 提案经 `POST /api/issues/:id/recovery-actions/agent-draft` 提交(advisory,不解除 hold)。

## 2. 测试计划(对照 issue 三步骤)

1. **API 正向** — 已执行的可回退修复触发一键回退:
   - 断言 revertSteps **逐步执行记录**(每步落 evidence/事件,有序、完整);
   - 断言**审计写入**(activity log 出现 revert 动作记录,含操作者、时间、目标 option);
   - 断言**状态回退**(提案卡/恢复动作回到提案执行前状态;验收标准即“回退后状态与提案前一致”);
   - 附加:重复回退幂等/拒绝、回退入口仅对 `revertible:true` 且已执行的 option 暴露。
2. **浏览器 E2E(dev :3104,硬性要求)**:
   - 回退入口在失败面板提案卡上**可见**;
   - 触发后**进度与结果反馈可见**(进行中状态 → 完成/失败反馈);
   - 回退后**提案卡状态更新**;
   - 证据:截图 + Playwright trace 落盘(附到 Paperclip artifact)。
3. **负向** — `revertible:false` 的 option **无回退入口**(UI 无按钮;API 对其回退请求返回 4xx)。

### 运行方式双层

- **回归层(仓库 harness)**: `tests/e2e/playwright.config.ts` 自建 throwaway 实例(:3199,
  local_trusted)。跑通功能回归,产出 trace。
- **dev 实例层(:3104,issue 硬性要求)**: 真实浏览器会话访问 dev 页面。dev 为 authenticated
  模式(localAiLoginSupported=true),执行时需要可用的 board 登录会话;若无法取得,向用户要
  登录方式(不得猜测凭据)。截图/trace 为验收证据。

## 3. 暂存的测试草稿(激活方式)

本目录两个 `.s8-draft.ts` 文件**刻意不匹配** vitest(`*.test.ts`)与 playwright(`*.spec.ts`)
glob,不会进入默认测试运行:

- `recovery-fix-revert.api.s8-draft.ts` → 激活:改名为
  `server/src/__tests__/issue-recovery-fix-revert.test.ts`,按实际端点路径/payload 修正 TODO;
- `recovery-fix-revert.browser.s8-draft.ts` → 激活:改名为
  `tests/e2e/recovery-fix-revert.spec.ts`,按 S6/S8 实际 DOM(data-testid)修正选择器 TODO。

### 激活前置 checklist

1. [ ] feature/recovery-ladder 出现 S8 实现 commit(回退 API + 卡片回退入口);
2. [ ] 合入 dev checkout 且 :3104 重启后 `/api/health.commit` ≠ f50845048(包含 S8);
3. [ ] dev UI 登录会话可用(board 访问);
4. [ ] API 测试在 ladder worktree 通过(`pnpm --filter server test` 或指定 vitest 文件);
5. [ ] E2E harness 回归通过 + :3104 真实浏览器证据(截图/trace)落盘;
6. [ ] 证据经 paperclip artifact 上传,issue 评论链接后置 done。
