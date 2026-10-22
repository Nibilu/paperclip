# AMB-101 测试计划:S7 超时自动决策(fake-clock 集成 + 浏览器 E2E)

- 日期:2026-10-22
- 状态:**等待前置条件** —— S7 实现尚未合入 dev(见 §1 当前状态核实)
- 需求正本:`doc/plans/2026-10-22-recovery-ladder-requirements.md`(recovery-ladder worktree,AMB-98 plan rev 1)§4-R4/R6、§5-S7、§7

## 1. 前置条件核实(2026-10-22 16:56 +0800,实证)

| 检查项 | 结果 |
|---|---|
| recovery-ladder worktree(`/home/amber/paperclip-recovery-ladder`,branch `feature/recovery-ladder`) | HEAD=875f4e488(S1–S5 已提交,最后提交 16:45) |
| S7 代码存在性 | **不存在**:全仓 grep `chosenByTimeout / auto_decided / confirmTimeout` 零命中;S6/S7/S8/S9 均未实现 |
| 实现进度 | 进行中:`server/src/services/reconciliation-analysis.ts` 与 `server/src/__tests__/issue-recovery-actions.test.ts` 有未提交改动(医生候选就绪门 S4 加固),非 S7 内容 |
| dev 实例(:3104) | 运行 commit **f50845048**(recovery-ladder 基线,**不含任何 recovery 代码**),health: `commit":"f50845048…"` |
| AMB-101 前置要求 | "S7 实现合入 dev 后执行" —— **未满足**,浏览器 E2E 无被测对象 |

结论:本 issue 的步骤 1–3 现在均无法执行(被测对象不存在)。为实现落地后零延迟启动,本计划预先冻结测试矩阵与 fixture(已对 committed S5 schema 实测验证,§3)。

## 2. 测试矩阵(验收 ⇄ 断言映射)

### 2.1 集成层(fake-clock,嵌入 PG,模式对齐 `server/src/__tests__/issue-recovery-actions.test.ts`)

Harness:embedded PG + express + supertest;fake clock:`vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })` + `vi.setSystemTime(...)` + `vi.advanceTimersByTimeAsync(...)`(仓库既有模式,见 `server/src/services/chat-publication-reconciliation.test.ts:150`)。

| # | 用例 | 驱动 | 断言 |
|---|---|---|---|
| I1 | 非超时路径不采纳 | 提案待确认,时钟推进 < 确认超时(默认 30min,可配) | 状态仍 pending/awaiting_confirmation;无 adopted 标记;无决策日志 |
| I2 | 超时采纳可回退 recommended | 时钟推进 ≥ 超时点,触发 S7 定时扫描 | 采纳 recommended;`chosenByTimeout=true`;evidence 含完整决策(提案快照、选择理由、revertSteps);activity log 有对应条目;通知事件生成(源 issue 评论 + 交互卡 + IM 投递链事件) |
| I3 | 采纳门:manual_shell | recommended 含 `permissionRequirements:["manual_shell"]`,超时 | **不采纳**;升级 board(L3);升级事件可审计 |
| I4 | 采纳门:executionScope=manual | recommended 为 `executionScope:"manual"`(即使 revertible=true),超时 | 同 I3 |
| I5 | 采纳门:全不可回退 | 所有 options `revertible:false`,超时 | 同 I3(反例主用例) |
| I6 | 审计可回放 | I2 后回读 | evidence JSON 含快照+理由+revertSteps+chosenByTimeout,字段可机器回放;activity log 时间线与 evidence 一致 |
| I7 | 非推荐选项永不采纳 | 多方案,超时 | 采纳的只能是 recommended;其他选项无副作用 |

### 2.2 浏览器 E2E(dev :3104,真实浏览器;Playwright 新 spec 对齐 `tests/e2e/` 基建)

| # | 用例 | 步骤 | 断言(截图/trace 证据) |
|---|---|---|---|
| E1 | auto_decided 状态卡 | 制造超时采纳后的 issue(dev 实例)| issue 页可见 "auto_decided" 状态卡;决策日志(提案快照/理由/revertSteps/chosenByTimeout)在卡内可见;截图 |
| E2 | 回退入口可点 | E1 同页 | 回退入口存在且可点击(revertSteps 渲染为操作指引或一键回退);点击后回退请求发出(S8 回退 API);截图/trace |
| E3 | 反例升级卡 | 全不可回退提案超时 | 页面无 auto_decided 卡;显示升级 board(L3)状态;截图 |
| E4 | 决策日志可回放 | E1 同页 | 决策全文与 activity log 一致(UI 与 API 双读对照) |

注:E1–E4 依赖 dev 实例部署含 S7(及 S6 提案卡)的代码。若 dev 部署形态与 `tests/e2e/execution-recovery/recovery.spec.ts` 的自起实例模式冲突,以本 issue 硬性要求为准(必须 :3104)。

## 3. Fixture(已对 committed S5 schema 实测通过)

验证方式:tsx 直接加载 `/home/amber/paperclip-recovery-ladder/server/src/services/reconciliation-analysis.ts` 的 `reconciliationAgentDraftSchema`,脚本与输出存于本机 scratch(`amb101-fixture-check.ts`)。2026-10-22 全部通过。

- **A(可自动采纳)**:单 recommended,`revertible:true` + 非空 `revertSteps`,`executionScope:"server_side"`,`permissionRequirements:["session_rebind","adapter_config_change"]` → schema 解析通过;不变式(recommended 恰 1、revertible、revertSteps 非空、scope≠manual、无 manual_shell)成立。
- **B1(永不自动采纳)**:recommended `revertible:false`(server_side)→ 作为 draft 解析通过(draft 本身合法;超时门必须拒绝采纳)。
- **B2(永不自动采纳)**:recommended `permissionRequirements:["manual_shell"]` + `executionScope:"manual"` → 解析通过;显式人工确认路径(C)可采纳,超时路径不可。
- **B3(永不自动采纳)**:recommended `revertible:true` 但 `executionScope:"manual"` → 解析通过;超时门必须拒绝。
- 实测修正:占位 UUID 必须是合法 UUID(schema 严格校验 version/variant 位),fixture 中已修正。

Schema 锚点(S5 已提交,`reconciliation-analysis.ts:14-70`):`FIX_OPTION_PERMISSION_REQUIREMENTS` 含 `manual_shell` 且注释明确 "such options are never auto-adopted on timeout";`fixOptionSchema.executionScope ∈ {server_side, doctor_run, return_owner_run, manual}`。

## 4. S7 落地后执行清单(零延迟启动)

1. 确认 dev :3104 health commit 包含 S7(对照 recovery-ladder 分支 merge);
2. §2.1 集成测试落盘至 recovery-ladder worktree 测试目录并 `vitest run`(PATH 注入 v22.17.1);
3. §2.2 Playwright spec 落盘至 `tests/e2e/`,对 :3104 执行,截图/trace 存档并按 Generated Artifacts 工作流上传;
4. 结果(双层)回帖 AMB-101,附证据链接;不通过则逐条列差异。

## 5. 风险与依赖

- S7 接口(定时扫描入口、超时字段落点、事件名)由实现方决定;§2 矩阵按行为契约编写,落地时仅绑定点位需对齐。
- dev 实例部署由用户/实现流程控制,本 issue 不自行切换 dev 分支。
- 与实现 agent 并行约束:不写入 `/home/amber/paperclip-recovery-ladder`(其有未提交改动)。
