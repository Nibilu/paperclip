# ACP Session 身份隔离：备选方案记录

## 决策状态

- 状态：备选方案，暂不实施
- 当前采用：所有 ACP 类 agent 在 Paperclip run 身份变化时启动新的 ACP 进程
- 暂不采用：host-side runtime identity broker
- 原因：优先保持与上游 ACP 接口兼容、降低 adapter-utils 与 provider 的耦合，并保留明确的 run 身份边界

## 背景

ACP 进程可以跨 heartbeat run 复用，但 Paperclip 的 `PAPERCLIP_API_KEY` 与 `PAPERCLIP_RUN_ID` 是 run-scoped 身份。已有 warm ACP 进程可能继续持有旧环境，从而使新 run 的 Paperclip API 请求使用旧身份并表现为资源访问 404。

## 适用范围与验证结论

本方案不是只针对 Codex 或 Hermes Gateway。基于当前仓库静态入口检查，所有当前实际调用共享 `@paperclipai/adapter-utils/acpx-engine/execute` / `createAcpxEngineExecutor` 的 ACP adapter 均进入同一 session fingerprint 逻辑：

- `claude-local`
- `codex-local`
- `gemini-local`
- `kimi-local`

因此 `runAuthTokenHash` 位于共享 ACP engine 层，当前代码路径上对上述四类 ACP adapter 一致生效。共享回归测试和 typecheck 已通过；Lucy/Codex 的实际 smoke test 只证明 Codex 路径，不能单独证明其他 adapter 的运行时安装、配置和 provider 命令均正常。

以下 adapter 不属于这条共享本地 ACP engine 路径，不能用本机制的测试结果代表它们：

- `hermes-gateway`
- `cursor-cloud`
- `openclaw-gateway`
- 其他未调用 `createAcpxEngineExecutor` 的 CLI、gateway 或 cloud adapter

未来新增 ACP adapter 必须复用共享 `acpx-engine/execute`，或显式实现等价的 run identity fingerprint；否则不能自动宣称受到本机制保护。

## 当前方案

将 run 身份指纹纳入 ACP session freshness：

```text
run token hash 变化
  -> session fingerprint 变化
  -> 不复用旧 ACP 进程
  -> 新进程获得新的 run API key/run ID
```

该机制对所有使用共享 ACP engine 的本地 ACP agent 一致生效，不针对 Lucy 做特例。

## 备选方案：host-side runtime identity broker

### 目标

在不重启 ACP 进程的前提下，使每个 Paperclip API 请求使用当前 run 的身份：

```text
ACP process -> host-side broker -> Paperclip API
```

ACP 对话、system prompt、developer prompt、工具定义和 provider session 可以保持不变；broker 在请求转发时动态注入当前 token 与 `X-Paperclip-Run-Id`。

### 关键约束

1. 真实 Paperclip JWT 只存在于 host 内存，不进入 ACP prompt、持久化 session 或日志。
2. broker capability 必须绑定 company、agent、ACP session、run 和 task scope。
3. 同一 ACP session 第一版只允许一个 active run，避免身份切换时并发请求串用。
4. run 完成、取消、超时或撤销时立即关闭对应 broker channel。
5. sandbox/remote ACP 必须通过现有受控 bridge，不暴露任意转发代理。
6. broker 故障必须 fail closed，不回退到旧 token。
7. Paperclip 服务端仍然校验 JWT/run/company/agent 绑定，broker 不替代服务端授权。

## 预期收益

- 同一 agent 的连续 run 可以复用 ACP 进程和对话上下文。
- 身份刷新不必修改 LLM prompt，理论上更有利于 provider prompt cache。
- 长任务和连续 heartbeat 可以减少 ACP handshake 成本。

## 主要代价

- 增加身份代理、channel 生命周期、并发排空和撤销逻辑。
- broker 成为新的可用性和安全边界。
- 本地、sandbox、remote execution 需要统一协议。
- 需要更完整的审计、trace 和故障诊断。
- 不保证不同 provider/agent 之间可以直接复用原生 ACP conversation。

## 跨 agent 续传边界

broker 适合解决同一 ACP session 的跨 run 身份刷新；Lucy 切换到 Hermi 时，不应直接复用 Lucy 的 provider session。跨 agent 续传应依靠 Paperclip task context、continuation summary、workspace、artifacts、run evidence 和未决决策。

## 触发实施条件

仅在以下需求成立时启动该方案：

- 连续 ACP run 的启动成本或上下文重载成本已经成为实际瓶颈；
- 需要保留同一 provider session 的上下文连续性；
- 已经有明确的串行 run 约束或 per-run broker channel 设计；
- 已补齐本地、sandbox、remote、取消、超时、并发和安全测试。

## 安全基线

在 broker 完成并通过端到端验证前，不得移除“run 身份变化启动新 ACP 进程”的保护。若 broker refresh 失败，必须安全回退为新进程，而不是复用旧 ACP 进程。
