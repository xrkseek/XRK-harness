# Learn: 三方对照总表（Cline · OpenCode · XRK）

> TODO: `lc8`  
> 汇总 lc1–lc7 与 lc4–lc6；**不**新增实现。  
> 决策已钉：ADR-0001/0002/0003；Effect → [ADR-0004](../adr/0004-no-effect-runtime.md)（lc10）。

---

## 1. 寿命与真源

| 维 | Cline | OpenCode V2 | XRK 选型 |
|----|-------|-------------|----------|
| Session | SessionRuntime 长寿 | Session + durable events 长寿 | SessionStore 长寿 |
| Loop / Run | AgentRuntime **每 run 新建** | SessionRunner **drain**（短寿执行） | `runTurn` 短寿 |
| Transcript 真源 | ConversationStore 可变数组 | durable events（+ 投影表） | **仅事件日志** |
| 模型可见 | runtime messages | History 投影 | `deriveMessages` + invariant |
| 同 session 并发 | running 门闩 | Coordinator run/join/wake | **单 in-flight**（TurnLatch + DrainLatch） |

---

## 2. 用户输入与执行

| 维 | Cline | OpenCode | XRK |
|----|-------|----------|-----|
| 新对话 | `run()` 清历史 | `sessions.create` | 显式 `newSession` |
| 续跑 | `continue()` | `prompt` + `resume`/`wake` | `continueTurn` + drain `wake`/`resume` |
| 只记账不跑 | 无一等公民 | `resume: false` admit | `admit`（HTTP 默认 202） |
| 插话 / 排队 | 单通道 | **steer / queue** | `delivery?` + promote 优先 + HTTP admit 透传 |

---

## 3. 工具

| 维 | Cline | OpenCode | XRK |
|----|-------|----------|-----|
| 定义 API | `createTool`（Zod/JSON + lifecycle） | `Tool.make`（Effect Schema） | `ToolDefinition` + registry.register |
| 执行管道 | before/after hooks + policy | leaf settle + Permission；registry bound output | **ToolPipeline** waterfall |
| 授权位置 | hooks / policies | **叶内** Permission；catalog 只过滤 | **guards**（坚持） |
| call 先于副作用 | 事件序 | durable call → settle | 规则已写 |
| 表快照 | 弱 | **materialize** + stale identity | 可吸 |
| 安全环/连续失败 | Mistake + LoopDetection @ session | （规格：重复 call 待做） | 旁路立项（lc3） |

详见 [createTool 映射](./create-tool-mapping.md)（lc9）。

---

## 4. 投影与压缩

| 维 | Cline | OpenCode | XRK |
|----|-------|----------|-----|
| 投影 | store 即数组 | Projector → message 表 | 读时 `deriveMessages` |
| live delta | RuntimeEvent | 不进 durable cursor | chunk 事件；derive 忽略 |
| compaction | overflow 一次 | 预算 + overflow；换窗口 | `context/compaction` + 一次 overflow |

---

## 5. 明确不搬的东西

| 项 | 原因 |
|----|------|
| Effect / Layer / Fiber | ADR-0004；学习成本≠产品语义收益 |
| 上游源码树 | ADR-0002 |
| Go / 多语言宿主 | ADR-0001 |
| ConversationStore.replaceMessages | 威胁 append-only |
| Registry 零 guard、全靠外部 Permission 上帝服务 | 与「显式 pipeline」分层目标冲突 |
| 集群 Session ownership / SQLite inbox 全套 | 过早；单机 latch + 事件日志先稳 |

---

## 6. 已吸收、待原子落地（总清单）

来自 learn，**实现另开 TODO，不在本条做**：

1. ~~SessionLatch（run/join/wake/cancel）~~ → 已落地：`createTurnLatch` + `createSessionDrainLatch`（见 [session-latch.md](../session-latch.md)）  
2. ~~API：admit-only vs admit+run；`newSession` / `continueTurn` 命名~~ → 已落地（见 [session-api.md](../session-api.md)）  
3. ~~mistake + loop tracker @ session~~ → 已落地（见 [session-safety.md](../session-safety.md)）  
4. ~~materialize 工具表 + stale~~ → 已落地：`materializeTools`（见 [tool-pipeline.md](../tool-pipeline.md) §9）  
5. ~~maxSteps 关工具 + 文案~~ → 已落地：末步注入 `MAX_STEPS_PROMPT`、tools=[]、拒执行  
6. ~~悬挂 tool fail-before-retry~~ → 已落地：`settleDanglingTools`（见 [tool-settlement.md](../tool-settlement.md)）  
7. ~~output bound（大结果路径）~~ → 已落地：`boundToolOutput` / pipeline `bound`；host preset 默认 `createWorkspaceToolOutputPersist`（见 [tool-output-bound.md](../tool-output-bound.md)）  
8. ~~parallel tool settle~~ → 已落地：`settleToolBatch` 双屏障（call 齐 → 并行 → result 按 call 序）；默认 `parallel`（见 [tool-settlement.md](../tool-settlement.md)）  
9. ~~compaction / overflow 一次恢复~~ → 已落地：`context/compaction` + `deriveMessages` 窗口 + overflow 一次重试（见 [session-compaction.md](../session-compaction.md)）  

---

勾选：`lc8` 完成。absorb §6 主清单已收束。

后续细作（非 §6）：[session-delivery.md](../session-delivery.md) §5 主路径已收束（含 steer 批合并）。
