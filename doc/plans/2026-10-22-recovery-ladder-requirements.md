# 恢复阶梯需求书:系统级状态模型、控制平面与分级恢复(Recovery Ladder v1.2)

- 日期:2026-10-22(v1);2026-10-27(v1.2);2026-10-27(v1.3,实施范围确认)
- 状态:**v1 已交付**(S0-S11,dev HEAD 1a96f7e76,2026-10-22);v1.2 设计评审完成;**v1.3 为当前有效设计**——实施范围已确认(2026-10-27):**第一阶段只做处理机制**(R11/R12+S13-S17,公司内医生挑选逻辑维持现状),**一等公民诊断主体(R13/S18)整体暂缓至第二阶段**。
- **正本**:本文件(fork 仓库 `doc/plans/2026-10-22-recovery-ladder-requirements.md`)。伴生镜像:Paperclip 顶层任务 **AMB-98** plan 文档 `3b3347f8`(与正本同步,注明对应 commit);artifacts 文档 `09c11645` 为事故取证。同步约定:改正本必须同轮同步伴生镜像并注明 commit(§9)。
- 来源:AMB-86 / AMB-90 / AMB-96 / AMB-97 事故取证(2026-10-22);**AMB-116 / AMB-117 事故取证(2026-10-27)**。
- 决策约束:不向 upstream 提 issue(非致命不提);实现落在本地 fork、低耦合、便于 rebase;涉及系统级改动前先提交本地并 fetch upstream 对齐(用户流程约定)。
- E2E 验收实例:AMB-86 / AMB-90 / AMB-96 / AMB-97(§6);AMB-116/117(v1.2 增量,§6)。

---

## 1. 系统级状态模型(现状,代码实证)

### 1.1 任务状态面
- Issue status:`todo / in_progress / in_review / blocked / done / cancelled / backlog`。
- Execution projection(`execution-projection.ts`):`phase / cause / attempt / maxAttempts(=3) / retryAt / permittedActions(["inspect_run"]) / predecessorRunId / successorRunId`。`inspect_run` 仅是失败 run 的 UI 权限标签,不是可执行的修复路径。
- 任务类型:issues 与 chat 均为 issue 行(chat 以 conversationAgentId 区分);plan 分解子任务是普通 issue。

### 1.2 恢复动作面
- Recovery action 生命周期:`active → resolved(outcome: blocked/cancelled/continued/…)`;字段含 `kind / ownerType(system|agent|board) / ownerAgentId / previousOwnerAgentId / returnOwnerAgentId / wakePolicy(bounded retry by agentId) / fingerprint / evidence / nextAction / attemptCount / maxAttempts`。
- kind 现状:`provider_quota`(system owner 等待)、`configuration_incomplete`、`deliberate_wait_without_target`(agent owner)、`stranded_assigned_issue`(retry 预算耗尽 → board)、`transient_infra`、`system_notice`、`non_retryable`、`external_service` 等。
- 跨 agent 诊断委派**已存在**(v1 交付):`reconciliation-analysis.ts` outbox。触发面 = native no-replay holds(`resolved+blocked+replay=blocked`)与 L2 stranded holds(`stranded_assigned_issue` + 分类 stamp);委派 INSPECT run 给同公司**非源 agent、非源 adapter** 的 ready 候选(`triedAgentIds/triedAdapterTypes`,≤3 次,deferral ≤10 次);agent JWT 只读 run 证据 + 提交 advisory draft(`agent-draft` 端点);草稿不解除 hold。
- 医生优先级已交付:agent `runtimeConfig.diagnosticPriority`;候选资格完全复用规范 invokability 定义({active,idle,running,error} 可调,{paused,terminated,pending_approval} 永不)。

### 1.3 会话绑定面(通道不对称)
- Paperclip 侧:每个 agent+issue 持久化 `sessionParams.sessionId`(续传锚点)。
- Hermes 侧:会话冻结 `launch_request`(state.db);CLI 引擎 resume 逐标志位同一性比较(缺键 vs 显式 = 拒绝,AMB-90 实证);ACP 引擎 `load_session/resume_session` 无策略校验。
- 推论:同一"会话绑定"概念在两引擎语义不同;跨引擎切换会把接缝变成任务阻断故障。

### 1.4 通知面
- 站内:issue 评论 + interactions(`request_confirmation` 卡,AMB-97 实证可承载修复提案并被批准执行)。
- IM:chat channels 投递链(doc/CHANNELS.md;Telegram/Feishu 优先)。R7 已交付分级通知。

### 1.5 自修复收敛面(现状缺口,AMB-116/117 实证,2026-10-27)
- `deliberate_wait_without_target` 修复链的出生:成功 run 未落 disposition → run-completion `reconcileLegacyContinuation` 以 fallback 派生 legacy episode(`legacyDispositionEpisode {id:源run, attempt:1, maxAttempts:2}`,指纹 `legacy_disposition:v1:*`)排 attempt 1;episode 在后续 attempt 间**自我延续**(全库 49/49 repair run 均为 legacy 形态)。
- 修复 run 自身 failed(实证:`acpx_turn_failed`,"Persistent ACP session … could not be resumed",~5s)后:**每个 sweep tick 静默 skip**——`readDispositionRepairAttempt(latestRun)` → `reconcileDispositionRepair` legacy 分支 → `decideLegacyContinuation` → `run_not_successful` → return,在到达 `owner_not_invokable`/耗尽升级分支之前返回。无 attempt 2(预算 1/2 未用尽)、无 board 升级、无系统评论。
- UI 不可见:该 cause 不在 `EXECUTION_RECONCILIATION_CAUSES`,blocker 谓词不命中,"Recovery needed / Inspect run" 卡不渲染;agent `error` 状态仍属规范 invokable 集合,无其他组件标红。
- 分类无消费者:`classifyRunFailure` 对该错误已有正式规则(`session_lifecycle.resume_failed`,retryPolicy=**bounded**,ladderHint=**L0**——设计意图是有界重试),但"failed repair run"这一状态没有任何分类消费点;L2 补章(`stampL2HoldsMissingAnalysis`)与 outbox 均不收该家族。
- 会话层前提缺失:重试若复用同一 dead session 则确定性重败(AMB-117 人工 retry + 2 次自动 retry 共 4 连败于同一 session id;0b06553b7 的 message-only forget 对 hermes_local 无 Paperclip 侧 task-session 行的形态未生效)。

## 2. 问题陈述(事故暴露的缺口)

- **G1 触发面窄**(v1 已修):v1 前仅覆盖 `replay=blocked`;现扩至 stranded/启动失败类。**遗留**:deliberate_wait 家族仍未入消费面(→R12/D3)。
- **G2 分类粒度粗**(v1 已修):`failureDetail.classification` 统一 taxonomy 已交付。**遗留**:分类结果对"自修复通道自身失败"无消费者(→R11)。
- **G3 无闭环**(v1 已修):R8 闭环执行器已交付。
- **G4 通知与选择权缺失**(v1 已修):R4/R7 已交付。
- **G5 自修复失败无分类消费、无收敛路径**(AMB-116/117):L1 修复 run 失败后既不重试也不升级,永久静默;补救 commit 43656a5af 在 run-completion 挂 per-错误签名 hook 并内联第三套分类匹配,对 49/49 真实 legacy 形态确定性无效——**教训:扩展既有分类消费面,不造平行机制;fixture 必须使用真实 lane 形态**。
- **G6 修复失败不可见**:卡死任务无 Recovery needed/Inspect run 入口,用户与 agent 均无可见抓手(AMB-116 存量实证)。
- **G7 诊断 agent 非一等公民**:当前医生是"同公司恰好好用的空闲 agent 兼任";无独立调用入口、无对外可查询状态、无与公司业务定义的对接契约;"对系统本身 debug/针对性修复/testing/迭代建议"目前由平台外独立 hermes agent 人工承担(2026-10-27 AMB-116/117 排查即此模式)。

## 3. 目标:四级恢复阶梯(控制平面一等机制)

```
L0 自动自愈      分类 → 可自动重试/等待(bounded retry、system owner 等待)
L1 原agent自修复  同 agent 可自动完成的修复(disposition repair 等,预算受限)
L2 跨adaptor医生   一等公民诊断 agent(§3.2)→ 结构化修复提案 → 授权/超时决策
                 → 执行 → 验证 run → resolve 恢复动作 → 唤醒 returnOwnerAgentId
L3 用户兜底      board 决策(现有语义,保持不变)
```

升级规则(v1.2 修订):任何异常先分类;**L1 修复通道自身的失败同样先分类**——`retryPolicy=bounded` 且 fresh session 前提成立 → 既有 scheduled-retry 重试;前提不成立、`never`、或预算耗尽 → board 升级(`escalateDispositionRepair`,既有);**修复通道不收敛(看门人,§R12)强制按上述路由收敛**;L2 路径失败(医生不可用/提案失败/验证失败,次数受限)才 L3。不新增 task status、不建第二调度器/恢复引擎。

### 3.1 权限边界
- 不变:no-replay hold 释放仍 board-only;false_positive/cancelled、workspace-base repair 仍 board-only;医生无 resolve 权("agents prepare, operators decide, server enforces" 字面成立)。
- 显式扩展(已评审交付):触发面扩大(R3);超时自动决策 = 确定性服务端策略(非 LLM)采纳 recommended 方案,仅限可回退且影响面单一,决策全文落 evidence+activity log;不可回退动作永不自动执行。
- 闭环 resolve:批准提案时同步移交 action ownership 给 returnOwnerAgentId,按现有 requireRecoveryActionAuthority 合法 resolve,不新增 system 越权路径。

### 3.2 医生角色规格(v1.2 重写:一等公民定位;v1.3 分阶段落地)
【定位修正,2026-10-27】诊断能力是**系统一等公民**,不属于单一公司——**不是**"某个公司的 agent 跨公司服务",而是平台级诊断能力**按公司投影**工作:

【分阶段确认,2026-10-27】
- **第一阶段(本次实施,R11/R12+S13-S17)**:**不在系统级新增诊断 agent 类型定义与显式入口**;本阶段交付的是**处理机制**——公司内自修复失败 → 分类消费 → 重试/升级的稳定闭环。医生挑选逻辑完全维持现状:同公司、状态正常({active,idle,running,error})、排除源 agent 与源 adapter(`triedAgentIds/triedAdapterTypes`)、`diagnosticPriority` 优先。**无合格候选时修复进入 queued task 排队等待**(scheduled_retry + 既有 backoff,任务界面可见),直到出现符合条件的 agent 为止,并在任务界面显示排队通知;attempt 预算耗尽仍 board 升级兜底(防永久占坑,2026-10-27 确认)。repair 通道的候选恒为原 owner(自修复语义),owner 不可用(paused 等)时立即 board 兜底不排队。验收标准:公司内该机制稳定可靠。
- **第二阶段(暂缓,R13/S18)**:一等公民诊断主体本体——系统级 agent 类型定义、显式调用入口、公司投影契约(业务逻辑/功能定义可查询、能力优先级=公司当前加载优先)、统一诊断状态对外查询。**待第一阶段稳定成熟后,凭积累的经验设计**(涉及复杂的公司投影权限与机制,2026-10-27 确认暂缓)。

- **调用入口**(三类,统一收敛到同一诊断 run 生命周期):①阶梯自动触发(L2 类别 stamp + 看门人);②显式 API / UI 手动触发(对指定 run/hold 发起诊断);③(远期)定时巡检。
- **对外状态**:诊断 run 生命周期可查询——现有 `evidence.reconciliationAnalysis.status`(pending/requested/dispatching/running/drafted/unavailable)即雏形,需升为对外可查询的一等状态(失败面板/通知引用)。
- **公司投影**:被调用时投影到目标公司上下文——遵循并可查询**该公司的业务逻辑与功能定义**(issue 语义、recovery 语义、公司加载的功能配置);所调用能力**优先以该公司当前加载的为基础**(该公司的 agent/adapter/skills/连接配置),平台默认仅兜底。现状对照:平台外 hermes agent 排查时阅读的正是真实代码与真实 DB 语义——R13 要把这一实践收编为系统内契约。
- **能力范围**(对齐现行实践):诊断、针对性修复、testing、以及与该问题相关的后续开发迭代建议方案;其中"修复"仍走 R4/R5/R8 授权闭环,不旁路 board。
- **安全语义**:run-bound agent 身份按目标公司投影(agent JWT 绑定 analysis run,现有机制);能力调用不越公司授权;诊断产出 advisory draft + fixProposal。
- 【复用】公司内委派选择层(排除源 agent/adapter、triedAgentIds、diagnosticPriority、健康门)仍是 L1→L2 的第一选择层;**一等公民诊断 agent 是 L2 的正式形态**——当公司内无合格候选(或按 R13 显式指定)时由平台诊断能力承接,不再依赖"恰好有空闲 agent"。
- 【保留】平台外独立 hermes agent 在机制落地前仍是引导工具(本次 AMB-116/117 排查即实证),落地后降级为旁路审计/兜底。

## 4. 需求清单(R1-R13)

- **R1 健全错误分类器(adapter 无关)**【已交付】:统一分类 taxonomy + 每 adapter 错误目录;`session_binding.resume_policy_refusal`、`runtime.adapter_boot_failure`、`session_lifecycle.resume_failed`(AMB-99 后补,bounded/L0)、`provider.*`、`infra.server_shutdown`、`workspace.*`、`unknown`(→L2)。非 hermes adapter 同样进入分类。
- **R2 自修复先行**【已交付】:L0/L1 可解不升级;预算沿用 wakePolicy。
- **R3 触发面扩大 + 医生选择**【已交付】:stranded/启动失败挂 `reconciliationAnalysis={status:pending}`;diagnosticPriority;健康门。**遗留**:deliberate_wait 家族(→R12/D3)。
- **R4 结构化提案与选择权**【已交付】:fixProposal options[]/permissionRequirements/revertSteps/recommended;超时自动采纳(可回退且影响面单一),决策全文落 evidence+activity log。
- **R5 权限与 review**【已交付】;**R6 可回退**【已交付】;**R7 通知**【已交付】;**R8 闭环执行器**【已交付】;**R9 观测**【已交付】;**R10 最后尝试摘要**【已交付】:stranding 时编译 attempts×{runId,errorCode,classification,stderrTail(脱敏),blockedOn} digest 入 evidence;Commands Run 从 run events 提取真实 tool 调用。
- **R11 自修复失败分类消费**(v1.2,对应 G5):failed repair run 是分类输入而非旁路对象——在 legacy 分支内消费分类结果;`bounded`+fresh session 前提 → scheduled-retry;`never`/前提不成立/耗尽 → `escalateDispositionRepair`(board)。复用 43656a5af 已交付的 persistedMaxAttempts / maxAttempts 透传 / expectedFingerprint 机器,**废弃其 per-错误签名私有 hook**(私有签名与 RULES 表漂移的教训)。
- **R12 meta-recovery 看门人**(v1.2,对应 G5/G6):与错误码解耦的收敛性触发器——sweep pre-pass(仿 `stampL2HoldsMissingAnalysis`)检测"修复通道不收敛"(active deliberate_wait/同族 hold + 最近 N tick 无 run 推进/attempt 不变/未升级)→ 按 R11 路由强制收敛;天然回填存量卡死(上线即解锁 AMB-116/117)。
- **R13 一等公民诊断 agent**(v1.2,对应 G7,定位见 §3.2;**第二阶段,暂缓**——第一阶段仅交付其处理机制前提,见 §3.2 分阶段确认):调用入口(自动/显式 API/UI)收敛到统一诊断 run 生命周期并对外可查询;分级通知对接(R7);目标公司投影契约(业务逻辑/功能定义可查询,能力优先以公司当前加载为准,平台默认兜底);产出 advisory draft + fixProposal,修复走授权闭环;平台外 hermes agent 引导模式收编为系统内机制。

## 5. 实施分解(每步带测试;独立 commit,优先独立 worktree)

**v1 已交付(2026-10-22,S0-S11,dev HEAD 1a96f7e76)**:S1 分类器、S2 证据写入、S3 触发面、S4 医生选择+规范资格、S5 提案 schema、S6 提案卡 UI、S7 超时自动决策、S8 回退、S9 闭环执行器、S10 最后尝试摘要、S11 IM 通知。

| # | 子任务 | 测试 | 备注 |
|---|---|---|---|
| S13 | 自修复失败分类消费(R11):legacy 分支按 retryPolicy 路由 failed repair run;移除 43656a5af 私有 hook | 单测:**fixture 必须携带真实 `legacyDispositionEpisode` 与 legacy 指纹**(AMB-116/117 实录形态;43656a5af fixture 遗漏该字段致绿灯≠修复) | 复用其 persistedMaxAttempts/透传/expectedFingerprint 机器 |
| S14 | fresh session 前提(R11):hermes_local 形态 dead-session forget 验证 / repair 重试 forceFreshSession | 集成测试:dead session 下重试必须 bootstrap 新会话,不得复用旧 session id | 覆盖 0b06553b7 未生效形态 |
| S15 | 存量回填 pre-pass(R12):扫现存 active hold + failed repair run → 按 R11 路由 | 单测:现存两单(AMB-116/117)数据形态 | 上线即解锁存量 |
| S16 | 看门人触发器(R12):非收敛 tick 阈值(N) + 强制收敛 | 集成测试(mock adapter):收敛/不收敛/升级三路 | 与错误码解耦 |
| S17 | UI 可见性(G6):blocker 谓词补 board 升级态的 deliberate_wait;通知分级对接 | 单测 + 浏览器 E2E | 可选,评审后定 |
| S18 | 一等公民诊断 agent 骨架(R13):设计评审(入口/状态/公司投影契约/能力优先级)→ 骨架(状态对外查询 + 显式触发 API) | 设计评审记录 + API contract 测试 | **第二阶段,暂缓**——待第一阶段(S13-S17)稳定成熟后凭经验设计 |

执行约定:每个代码子任务独立 commit;每步完成即测试并记录证据,失败即停不跳步。

**实施范围确认(2026-10-27)**:第一阶段 = S13(入口迁移:legacy 分支消费分类,移除 43656a5af 私有 hook)+ S14(repair 重试 forceFreshSession)+ S15(存量回填 pre-pass)+ S16(看门人)+ S17(排队通知/UI 可见性)。已确认决策:①无合格候选 → 预算内排队(scheduled_retry+backoff+通知),耗尽仍 board 兜底;②recon stamp 进 outbox(触发面再扩大)**不在第一阶段**;③repair 通道候选恒为原 owner,owner 不可用即 board 兜底。上游比对(2026-10-27):355 commits,`decideLegacyContinuation` 的 `run_not_successful` skip 语义未变,上游未覆盖本缺口,fork 本地低耦合实现。

## 6. E2E 实例映射

| 实例 | 故障类别(分类器) | 验证的阶梯路径 | 前置状态 |
|---|---|---|---|
| AMB-96 | `runtime.adapter_boot_failure` | L2 修复已发生(pm install --extra acp)→ 验证/归还分支;已自愈对照 | in_progress |
| AMB-86 | `runtime.adapter_boot_failure` | L1/L2 全链路:诊断→提案→授权→验证→resolve→唤醒;ACP 会话续传 | blocked(保持,不手动解决) |
| AMB-90 | `session_binding.resume_policy_refusal` | L2 全链路主用例:三选一提案→授权/超时→执行→验证→归还 | blocked(保持,不手动解决) |
| AMB-97 | (医生链路参照) | 人工已走完诊断→批准→执行→验证→收口;行为基线 | done |
| AMB-116/117 | `session_lifecycle.resume_failed`(L0,bounded) | **v1.2 增量**:failed repair run → 分类消费 → fresh-session 重试 → 耗尽升级 → 看门人回填;S13-S16 验收实例 | AMB-116 in_progress(存量卡死);AMB-117 blocked(stranded,board) |

## 7. 权限与安全边界

- 医生 agent 权限:只读 run 证据 + `agent-draft` 提交(agent JWT 绑定 analysis run);**无 resolve 权**。
- 执行授权:显式确认或超时自动决策;仅限可回退且影响面单一;不可回退动作永不自动执行(R6)。
- 公司投影安全(R13):run-bound 身份按目标公司投影;能力调用以该公司加载为准,不扩大授权面;诊断产出与提案不携带凭据/secret_ref。
- 通知脱敏:不含凭据;IM 推送走既有 publications 投递链。
- 与上游原则一致:不建第二调度器/恢复引擎;所有状态收敛于 recovery action 生命周期。

## 8. 与上游的同步策略

- v1 S0 已完成:134 提交比对,task-recovery/failover 未覆盖 R4/R6/R8 等价物,本地实现。
- 实现布局:新增文件优先;既有文件侵入点限于 recovery service 挂钩与 schema 扩展,控制单文件 diff 规模,便于 rebase。涉及系统级改动前 fetch upstream 对齐(用户流程约定)。
- 不向 upstream 提 issue(用户决定,2026-10-22)。

## 9. 文档双层模式(2026-10-27 定)

- **正本**:本文件(repo `doc/plans/`),版本化、随代码演进、可 PR review。
- **伴生镜像**:Paperclip 任务内 document(如 AMB-98 plan)——agent 可读层,与正本同内容,标注对应 commit;任务内另有 artifacts 文档承载事故取证。
- 同步约定:修改设计必须同轮更新两处并在伴生镜像注明 commit;任务评论只做变更审计摘要,不承载设计正文。
- 系统级需求一律进正本(不散落任务评论);事故任务(AMB-116/117 等)留在业务公司,经 §6 映射表与链接关联。
