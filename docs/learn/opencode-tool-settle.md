# Learn: OpenCode Tool · Registry · Settle

> TODO: `lc5`  
> 源码 / 说明：
>
> - `XRKbar/opencode/packages/core/src/tool/AGENTS.md`（**分层真源**）
> - `tool/tool.ts` — `Tool.make` / opaque settle
> - `tool/registry.ts` — `materialize` + `settle`
> - Runner 接线：`session/runner/llm.ts`（先记 call，再 `toolMaterialization.settle`）
>
> 本仓对照：[`docs/tool-pipeline.md`](../tool-pipeline.md)、`packages/core/tools`。  
> 前置：lc4。态度：取精华 · **不搬 Effect Schema 全家桶**。

---

## 1. 一句话分层

| 层 | OpenCode | 职责 |
|----|----------|------|
| **Tool 值** | `Tool.make({ description, input, output, execute, toModelOutput? })` | 不透明；编解码 + 执行 + 定义派生私有 |
| **ApplicationTools** | 进程级 | 全 Location 共享的应用工具注册 |
| **ToolRegistry** | **Location 级** | overlay 本地注册；`materialize` 出本 turn 的 definitions + settle |
| **Leaf** | bash/edit/… | **自己**做 permission + 副作用顺序；registry **不做**执行授权 |
| **ToolOutputStore** | settle 之后 | **唯一**通用「模型输出封顶 / 托管路径」边界 |

`AGENTS.md` 硬约束：不要再搞第二套可执行入口、registry 自带 executor、authorization callback、legacy normalize。

---

## 2. `materialize`：目录可见 ≠ 执行授权

```text
materialize(permissions?)
  → 合并 Application ∪ Location（同名 Location 赢）
  → 整工具 deny（action=* effect=deny）则从 **definitions** 删除
  → 返回 { definitions, settle(input) }
```

要点：

1. **过滤目录**只影响「模型能不能看见这工具」；若 call 仍到达 settle（陈旧/竞态），leaf 策略仍会跑——或返回 `Stale tool call`（见下）。
2. **`settle` 闭包捕获 identity**：`materialize` 当时登记的 `registration.identity`；若 settle 时栈顶工具已换实例 → `Stale tool call`；未知名 → `Unknown tool`。
3. Runner 在 **达 max steps** 时根本不 `materialize`（`toolMaterialization = undefined`），并 fail unsettled。

对照本仓：

| OpenCode | XRK |
|----------|-----|
| materialize 快照 definitions | registry.list / schema 给 LLM |
| settle 闭包 + identity | 尚无「本 step 工具表冻结」；可后加 |
| catalog deny ≠ auth | pipeline **guards** 才是执行授权（更接近 DSH） |

**吸取：** turn 级「工具表快照」防热替换竞态；目录过滤与执行授权分开说清。  
本仓已用 pipeline 做执行授权——**保持**；不要学成「registry 无 guard」。OpenCode 把 auth 下沉到 leaf+PermissionV2，我们用显式 waterfall 更贴 AGENTS「无上帝对象」。

---

## 3. 单次 `settle` 流水线（工具叶）

`Tool.make` 内 runtime.settle：

```text
decode(input schema)
  → execute(input, context)     // 仅 ToolFailure；勿吞 interrupt
  → encode(output schema)
  → optional structured / toModelOutput → content parts
```

Registry `settleWith` 再包一层：

```text
resolve registration（Location 栈顶 || Application）
  → tool.settle
  → catch ToolFailure → { result: error }
  → ToolOutputStore.bound(...)   // 通用截断 / outputPaths
  → ToolOutput.toResultValue
```

**Context 最小字段：** `sessionID | agent | assistantMessageID | toolCallID`。  
Permission source（叶内）：

```ts
{ type: "tool", messageID: assistantMessageID, callID: toolCallID }
```

**吸取：**

- 输入/输出 schema 校验在边界，失败变成模型可读 error result，不炸 runner。
- **领域输出完整** vs **给模型看的截断** 分开（Bash 自己限 capture bytes；registry 再 bound model output）。
- 中断/缺陷不要 `catchCause` 抹掉。

**不取：** Effect Schema 作为唯一工具 DSL；WeakMap opaque 可学思路，实现用普通闭包即可。

---

## 4. 与 Runner 的契约（接 lc4）

```text
stream event tool-call（非 providerExecuted）
  → 已由 publisher 持久化 call
  → Fiber: materialization.settle({ sessionID, agent, assistantMessageID, call })
  → publish toolResult(+ outputPaths)
await 全部 tool fibers 后再决定 needsContinuation
```

顺序铁律（规格 + 实现一致）：

1. **先 durable 记 call，再副作用**  
2. **eager 启动、stream 结束后统一 await**  
3. **结算事件挂 assistantMessageID**（provider call id 跨 turn 可能重复）

对照本仓 `tool-pipeline.md`：

```text
tool/call (session, by loop) → pre → guards → execute → post → finalize → freeze tool/result
```

| 维 | OpenCode | XRK ToolPipeline |
|----|----------|------------------|
| call 先于执行 | ✅（publisher） | ✅（规则 1） |
| 授权 | leaf Permission + catalog filter | **guards 单调 deny** + pre ask |
| 超时/重试 | 叶/进程侧 | execute around + timeoutMs / transient retry |
| 结果不可变 | 事件投影 | `freezeToolResult` |
| 额外塞给模型的上下文 | 较少在 settle | post `additionalContexts` → batch user/message |
| 并行 | FiberSet eager | **`settleToolBatch`**：call 屏障 → parallel/serial → result 按 call 序 |

**本仓已对齐的精华：** call-before-body、冻结结果、显式阶段。  
**还可吸的：** materialize 快照 / stale 检测；output 双层（完整域 vs 模型界）；settle 与 assistantMessageID 绑定。

---

## 5. 注册作用域

```text
ApplicationTools（进程）  ←── Location Tools.register 可覆盖同名
         │
         ▼
   ToolRegistry.materialize
```

- 同 placement 最新注册赢；Scope finalizer 卸掉一层后露出下一层。  
- **禁止**把 Registry 做成进程全局；也禁止「每个 Location 再复制一套 ApplicationTools」。

对照本仓 presets：`minimal` / `harness` 在 composition 上挂 registry——更像 **session/composition 作用域**。若将来多 workspace 并行，应对齐「Location 级 registry」，而不是单例全局 Map。

---

## 6. 取 / 不取

**取：**

1. **一种 Tool 表示**（应用与内置同型）；registry 只存 canonical。  
2. **`materialize` 快照** + stale identity。  
3. **目录过滤 ≠ 执行授权**（话术与测试要分开）。  
4. **settle 唯一出口**做通用 output bounding；叶不做「给模型截断」的第二套。  
5. call 持久化 → settle → result 持久化；中断失败显式写入。  
6. 注册可叠加、可卸除（Scope/ disposer 思维）。

**不取：**

- Registry 零授权、全靠 Permission 服务（我们坚持 pipeline guards）。  
- Effect Schema / Layer 注册树。  
- 立刻上 MCP/Session 作用域注册的复杂设计（OpenCode 自己也标 gap）。  
- 把 approval UI 协议塞进 settle（本仓 pre `ask` 钩子已够 M1）。

---

## 7. 后续原子 TODO（立项）

| 建议 | 内容 |
|------|------|
| tools-materialize | `runTurn` 步初 `freezeToolTable()`；settle 校验同 identity |
| tools-output-bound | 通用 `finalizeContent`/store：大输出落路径 + 模型短摘要（对标 ToolOutputStore） |
| tools-parallel | ~~step 内并行 settle + 全 await~~ → `settleToolBatch` + `toolSettle` |
| registry-scope | 文档：composition/workspace 级 registry，禁进程上帝单例 |

---

勾选：`lc5` 完成。  
下一条建议：`lc6` — projector / 事件重放 ↔ `deriveMessages`；或 `lc8` 三方对照表收束。
