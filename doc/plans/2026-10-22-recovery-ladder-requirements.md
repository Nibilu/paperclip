# 恢复阶梯需求书:系统级状态模型、控制平面与分级恢复(Recovery Ladder v1)

- 日期:2026-10-22
- 状态:设计定稿,待实现(分解见 §5)
- 来源:AMB-86 / AMB-90 / AMB-96 / AMB-97 事故取证(2026-10-22,dev :3104)
- 决策约束:不向 upstream 提 issue(非致命不提);实现落在本地 fork、低耦合、便于 rebase;涉及系统级改动前先提交本地并 fetch upstream 对齐(用户流程约定)
- E2E 验收实例:AMB-86 / AMB-90 / AMB-96 / AMB-97(§6)

---

## 1. 系统级状态模型(现状,代码实证 2026-10-22)

### 1.1 任务状态面
- Issue status:`todo / in_progress / in_review / blocked / done / cancelled / backlog`。
- Execution projection(`execution-projection.ts`):`phase / cause / attempt / maxAttempts(=3) / retryAt / permittedActions(["inspect_run"]) / predecessorRunId / successorRunId`。`inspect_run` 仅是失败 run 的 UI 权限标签,不是可执行的修复路径。

### 1.2 恢复动作面
- Recovery action 生命周期:`active → resolved(outcome: blocked/cancelled/continued/…)`;字段含 `kind / ownerType(system|agent|board) / ownerAgentId / previousOwnerAgentId / returnOwnerAgentId / wakePolicy(bounded retry by agentId) / fingerprint / evidence / nextAction`。
- kind 现状:`provider_quota`(system owner 等待)、`configuration_incomplete`、`deliberate_wait_without_target`(agent owner,同 agent 自修 disposition)、`stranded_assigned_issue`(本次事故类别,retry 预算耗尽 → board)、`transient_infra`、`system_notice`、`non_retryable`、`external_service` 等。
- 跨 agent 诊断委派**已存在**:`reconciliation-analysis.ts` + `-policy.ts`。仅当 `evidence.automaticRecovery.replay=blocked`(legacy 中断 run 对账类)时挂 `evidence.reconciliationAnalysis={status:pending}` 并入 outbox;委派 INSPECT run 给**不同的** ready/idle agent(排除源 agent 与其 adapter 类型:`triedAgentIds`/`triedAdapterTypes`,上限 3 次,失败重排);受委派 agent 以自身 agent JWT 读取 run 证据并经 `POST /api/issues/:id/recovery-actions/agent-draft` 提交 **advisory** 草稿;草稿不解除 hold,仍由人工 resolve。

### 1.3 会话绑定面(通道不对称)
- Paperclip 侧:每个 agent+issue 持久化 `sessionParams.sessionId`(续传锚点)。
- Hermes 侧:会话冻结 `launch_request`(state.db `state_meta` key `gateway.local_policy.v1:<session_id>` → `policy.request_json`)。
- **CLI 引擎**(`hermes chat --resume`):resume 时逐标志位与冻结 `launch_request` 做同一性比较(`hermes_cli/gateway_chat.py check_resume_policy`);冻结记录**缺键** vs 显式传参 = 拒绝(exit 2),即使语义路由完全一致(AMB-90 实证:实际路由 nvidia,冻结记录无 provider 键,重放 `--provider nvidia` 被拒)。
- **ACP 引擎**(`acp_adapter/server.py load_session/resume_session`):**无任何** launch 策略/provider 校验,provider 在 agent 构建时从 config 现取。
- 推论:同一"会话绑定"概念在两个引擎语义不同;跨引擎切换(agent 从 acp 改 cli)会把接缝变成任务阻断故障。

### 1.4 通知面
- 站内:issue 评论 + interactions(`request_confirmation` 卡,AMB-97 实证可承载修复提案并被批准执行)。
- IM:chat channels 机制(`doc/CHANNELS.md`,chat-channels/publications 投递链)。Hermes 侧另有 Telegram/Feishu 通道(平台已接入)。

## 2. 问题陈述(本次事故暴露的缺口)

- **G1 触发面窄**:reconciliation-analysis 仅覆盖 `replay=blocked`;`stranded_assigned_issue`、adapter 启动失败(AMB-86/96)、resume 策略拒绝(AMB-90)直接落到 board,无委派诊断。
- **G2 分类粒度粗**:一切适配器失败折叠为 `adapter_failed` / `acpx_*`;控制平面无法按类别选择恢复路径。
- **G3 无闭环**:修复被批准并执行后(AMB-97 卡 1:`hermes pm install --extra acp`,已落地),系统不验证、不 resolve 源恢复动作、不按 `returnOwnerAgentId` 唤醒原 owner;用户看到的是悬空的第二张卡。
- **G4 通知与选择权缺失**:多方案修复无结构化选择 UI;无超时自动决策;无 IM 主动通知。

## 3. 目标:四级恢复阶梯(控制平面一等机制)

```
L0 自动自愈      分类 → 可自动重试/等待(bounded retry、system owner 等待)
L1 原agent自修复  同 agent 可自动完成的修复(disposition repair 等,预算受限)
L2 跨adaptor医生   诊断(delegated inspect)→ 结构化修复提案 → 授权/超时决策
                 → 执行 → 验证 run → resolve 恢复动作 → 唤醒 returnOwnerAgentId
L3 用户兜底      board 决策(现有语义,保持不变)
```

规则:**任何异常先分类;L0/L1 无法解决才升级 L2;L2 路径失败(医生不可用/提案失败/验证失败,次数受限)才升级 L3**。L2 不是新机制——是现有 reconciliation-analysis 的触发面扩大 + 授权闭环补全。

## 4. 需求(本次补充)

- **R1 健全错误分类器**:run 失败时产出结构化分类(`failureDetail.classification`),初始类别:`session_binding.resume_policy_refusal`(exit 2 + "Resume retains gateway session policy")、`runtime.adapter_boot_failure`(ACP "exited before initialize"/ModuleNotFoundError)、`provider_quota`(已有)、`infra.server_shutdown`(已有)、`unknown`。分类知识沉淀于 skill `hermes-runtime-ops` / `paperclip-instance-ops`。
- **R2 自修复先行**:分类为 L0/L1 可解的(如 disposition repair、可重试等待)不升级;原 agent 自修复预算沿用 `wakePolicy`。
- **R3 跨 adaptor 医生介入**:L1 失败或不可解时,按现有委派策略选医生(排除源 agent+adapter、`triedAgentIds/triedAdapterTypes`、ready/idle、最近成功率),触发面扩大到 §2-G1 所列全部类别。
- **R4 结构化修复提案与选择权**:`agentDraft` 扩展 `fixProposal`:`options[]`(每项含 `id/title/description/permissionRequirements[]/revertSteps[]`),标 `recommended`;多方案时**用户有选择权**(交互卡);**确认超时(可配,默认 30min)自动采纳推荐方案继续执行**,并将完整决策(提案快照、选择理由、`revertSteps`、`chosenByTimeout:true`)写入恢复动作 evidence 与 activity log,**保证可回退**。
- **R5 权限与 review**:提案卡标注每方案所需权限;涉及配置类修改(provider/engine/会话重建)必须显式确认或超时自动决策;执行后自动产出 review 证据(验证 run 摘要 + 前后对比);review 失败回到 L1(次数受限)再 L3。
- **R6 可回退**:不可自动化的 `revertSteps` 渲染为操作指引;可自动化的提供一键回退;回退本身写审计日志;**永不自动执行不可回退动作**(如删除数据)。
- **R7 通知**:阶梯各级事件(升级到 L2 / 新提案 / 超时自动决策 / 回退 / 归还原 owner)同步:(a) 源 issue 评论 + 交互卡;(b) **IM 渠道主动推送**(经 chat channels 投递链;Telegram/Feishu 优先);分级 `info / needs_confirmation / auto_decided`;通知不含凭据与 secret_ref。
- **R8 闭环执行器**:授权(显式或超时采纳)后:执行修复(系统可执行部分由控制平面执行,agent 可执行部分由医生 agent 执行)→ 最小验证 run(真实 wake 或分类对应的探测)→ 成功则 `resolve(recovery action, outcome=continued)` 并唤醒 `returnOwnerAgentId`;失败回 L1。
- **R9 观测**:决策日志可查询(recovery action evidence + activity);UI 失败面板显示当前阶梯层级(L0/L1/L2/L3)与医生 run 链接。

## 5. 分解:单步骤子任务(顺序执行,每步带测试)

| # | 子任务 | 改动点 | 测试 | 完成标准 |
|---|---|---|---|---|
| S0 | 基线与上游同步 | 清点处置未跟踪探针脚本;`git fetch upstream` 比对 134 提交中 task-recovery/failover 是否已覆盖本需求;基线报告 | — | 报告落盘;无未提交源码 |
| S1 | 错误分类器(纯函数) | 新文件 `server/src/services/recovery/failure-classification.ts` | 单测:用 AMB-86/90/96 真实错误样本做 fixture | 分类输出与 §4-R1 一致;无侵入 |
| S2 | 分类接入失败路径 | run 失败落库写 `failureDetail.classification`;projection 增 `classification` 字段 | projection 快照测试;现有测试回归 | UI cause 文案不变,新增字段可读 |
| S3 | 触发面扩大 | recovery service 创建 `stranded_assigned_issue`/boot failure 动作时挂 `evidence.reconciliationAnalysis={status:pending}` | 单测:三类 fixture 均入 outbox;replay=blocked 原路径回归 | 三类失败自动进委派诊断 |
| S4 | 医生选择策略 | 选择函数(排除规则+健康度) | 单测:排除/回退/耗尽→L3 | 与现有 triedAgentIds 语义一致 |
| S5 | 提案 schema | `reconciliationAgentDraftSchema` 扩展 `fixProposal`(R4 结构) | zod 单测 + API contract 测试 | 旧 draft 兼容 |
| S6 | 提案卡 UI + 选择权 | 失败面板渲染多方案卡、推荐标注、倒计时;**浏览器 E2E** | 单测 + **浏览器端到端**(dev:3104:渲染/点选/推荐高亮) | 截图/证据落盘 |
| S7 | 超时自动决策器 | 定时器→采纳 recommended→审计日志→通知;fake-clock | 集成测试:超时路径、非超时路径、日志断言 | 决策可回退字段完整 |
| S8 | 回退 | revertSteps 渲染;可自动化项一键回退;回退写审计 | API 测试 + **浏览器 E2E**(回退入口) | 回退后状态与提案前一致 |
| S9 | 闭环执行器 | 授权后:执行→验证 run→resolve→wake returnOwner;失败回 L1 | 集成测试(mock adapter,以 AMB-86 恢复动作为 fixture) | 四任务场景全覆盖 |
| S10 | IM 通知 | chat channels 投递挂接(Telegram/Feishu);分级模板 | 集成测试(测试 chat 收到三类通知) | 通知无凭据泄漏 |
| S11 | 全链路 E2E | 见 §6;**浏览器驱动** | AMB-90 全链路 + 超时路径 + AMB-86 ACP 续传(83 msgs 延续不新建)+ AMB-96 对照 | 四实例验收记录 |
| S12 | 收尾 | 更新本文档状态;skill 交叉引用(`paperclip-instance-ops` / `hermes-runtime-ops`) | — | 文档与实现一致 |

执行约定:每个代码子任务独立 commit(优先独立 worktree,主 checkout 仅在无未提交源码时使用);每步完成即测试并记录证据,失败即停不跳步。

## 6. E2E 实例映射

| 实例 | 故障类别(分类器) | 验证的阶梯路径 | 前置状态 |
|---|---|---|---|
| AMB-96 | `runtime.adapter_boot_failure` | L2 修复已发生(pm install --extra acp)→ 验证/归还分支;作为已自愈对照 | in_progress(首个修复后 ACP run 已实测通过) |
| AMB-86 | `runtime.adapter_boot_failure` | L1/L2:诊断 → 提案 → 授权 → 验证 → resolve → 唤醒;**ACP 会话续传**(state.db 045f67 83 msgs 延续,不新建) | blocked(保持,不手动解决) |
| AMB-90 | `session_binding.resume_policy_refusal` | L2 全链路主用例:三选一提案(provider=auto / 会话代际重组 / adapter 归一化)→ 授权/超时 → 执行 → 验证 → 归还 | blocked(保持,不手动解决) |
| AMB-97 | (医生链路参照) | 人工已走完 诊断→卡→批准→执行→验证→收口 done;作为行为基线 | done |

## 7. 权限与安全边界

- 医生 agent 权限:`inspect_run` 只读 + `agent-draft` 提交(agent JWT 绑定 analysis run,现有机制);**无 resolve 权**。
- 执行授权:配置类修改(provider/engine/会话重建)必须显式确认或超时自动决策;超时自动决策仅适用于**可回退且影响面单一**的方案;不可回退动作永不自动执行(R6)。
- 通知脱敏:不含凭据/secret_ref;IM 推送走既有 publications 投递链,不新建通道。
- 与上游原则一致:不建第二调度器/恢复引擎;所有状态仍收敛于 recovery action 生命周期。

## 8. 与上游的同步策略

- S0 先行:fetch upstream,重点核对 `doc/task-recovery.md` 幂等 Retry/generation fence、native harness failover expiration 是否已覆盖 R4/R6/R8 的等价物;若覆盖则改为对接而非新增。
- 实现布局:新增文件优先(failure-classification、doctor-selection、closure-executor),对既有文件的侵入点限于 recovery service 挂钩与 schema 扩展,控制单文件 diff 规模,便于 rebase。
- 不向 upstream 提 issue(用户决定,2026-10-22)。
