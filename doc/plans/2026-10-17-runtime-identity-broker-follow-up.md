# 后续需求建议：Host-side Runtime Identity Broker

## 目标

为所有使用共享 ACP engine 的 agent 增加 host-side runtime identity broker，使 ACP 进程可以跨 Pilibala run 复用，同时保证每个 API 请求都使用正确的 run-scoped 身份。

## 当前适用范围基线

当前仓库静态入口检查显示，共享 `@pilibalaai/adapter-utils/acpx-engine/execute` / `createAcpxEngineExecutor` 的 ACP adapter 为：

- `claude-local`
- `codex-local`
- `gemini-local`
- `kimi-local`

当前 run identity fingerprint 修复位于共享 ACP engine 层，因此对上述四类 adapter 的代码路径一致生效。已有共享 ACP 回归测试和 adapter-utils typecheck 通过；Codex/Lucy 的 live smoke test 不能代替其他三类 provider 的完整运行时矩阵验证。

`hermes-gateway`、`cursor-cloud`、`openclaw-gateway` 及其他不调用共享 ACP engine 的 adapter 不属于这项机制的覆盖范围。未来新增 ACP adapter 必须复用该 engine，或显式实现等价的 run identity 隔离。

## 建议拆分

### 需求 1：身份 broker 生命周期

- 为每个 ACP session 创建隔离 broker/channel。
- 支持 bind、refresh、revoke、close。
- broker 状态只保存在 host 内存。
- 不持久化真实 Pilibala JWT。

### 需求 2：动态 API 转发

- ACP 使用稳定的 broker URL/capability。
- broker 根据当前 channel 注入 `Authorization` 和 `X-Pilibala-Run-Id`。
- 只允许 Pilibala API 的受控路径。
- 禁止任意 URL 代理和跨 company 转发。

### 需求 3：串行 run 约束

第一版要求同一 ACP session 同时只有一个 active run：

- 旧 run 进入 draining；
- 等待旧请求完成；
- 原子切换到新 run identity；
- 旧 channel 立即失效；
- 并发 run 默认排队或拒绝。

### 需求 4：sandbox/remote bridge

- 复用现有 Pilibala callback/process-session bridge。
- 不直接暴露 host broker 端口到远程网络。
- bridge 断开时 broker channel 自动撤销。
- remote/sandbox 请求与 host 请求使用同一身份绑定规则。

### 需求 5：服务端身份校验

每个请求必须校验：

```text
JWT company_id == run.company_id
JWT agent_id == run.agent_id
JWT run_id == X-Pilibala-Run-Id
run 未取消、未过期、未撤销
issue/task 在当前 scope 内
```

broker 不得替代 Pilibala 服务端授权。

### 需求 6：并发、取消和超时

覆盖：

- run 正在执行时切换 agent；
- run 被取消时撤销 channel；
- provider timeout 后关闭 channel；
- broker 请求排空；
- late request 不得写入 Pilibala；
- broker 重启后全部旧 capability 失效。

### 需求 7：安全与诊断

- token 不进入 prompt、session 文件、日志和错误消息。
- 只记录 token hash 或 request correlation ID。
- 记录 broker session、channel、agent、run、路径和结果分类。
- 404/403 诊断信息只进入服务端审计，不回显 token 或敏感内容。

### 需求 8：跨 agent 任务续传

不直接复用 provider-specific ACP session。应复用：

- task heartbeat context；
- continuation summary；
- workspace；
- artifacts/work products；
- run evidence；
- unresolved decisions。

Lucy → Hermi 的 handoff 必须经过 task context，而不是把 Lucy 的隐藏 prompt、provider session 或 token 传给 Hermi。

## 验收标准

1. run A 使用 token A，run B 使用 token B。
2. ACP 进程 PID/session 不变时，run B 请求只能使用 token B。
3. run A 的旧请求不能在 run B 中写入任务。
4. run 取消后，旧 channel 的写请求失败且不产生副作用。
5. broker 重启后旧 capability 全部失效。
6. token 不出现在 prompt、持久化 session、日志和 artifact 中。
7. Lucy/Codex local、Hermi 可用的 ACP/local 路径、Claude/Cursor/Gemini/Kimi 等共享 ACP engine 路径通过同一套测试。
8. sandbox 和 remote execution 不能绕过 broker 访问真实 Pilibala API。
9. system prompt、developer prompt、工具 schema 和 ACP conversation 不因身份刷新被无谓修改。
10. 同一 task 从 Lucy 切换到 Hermi 时，task context、workspace、artifacts 和 handoff summary 可恢复；不要求 provider-specific ACP session 直接复用。

## 交付拆分建议

- Phase A：broker contract、内存状态机、串行 channel、单元测试。
- Phase B：本地 ACP host integration、Codex/Claude 回归。
- Phase C：sandbox/remote bridge integration。
- Phase D：取消/超时/并发/安全审计测试。
- Phase E：跨 agent task handoff 与上下文压缩验证。

## 暂不做

- 不支持第一版同一 ACP session 的并发多 run channel。
- 不允许不同 provider 直接共享原生 ACP conversation ID。
- 不通过 broker 自动扩大 agent 权限。
- 不自动解除 AMB-16 hold。
- 不改变当前 v0.1 的任务状态和 recovery 权限边界。
