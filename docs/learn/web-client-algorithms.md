# Web 客户端算法（深读 · 自研转换 · lc20）

> **调研 · 取精华 · 自研。** 不是并入 DeepSeek Cordis/ui-*；把可证明的算法规则写成 XRK 自己的纯 TS 模块。  
> 上游参考：`deepseek-harness` `client/runtime` · `client/web` · `client/ui-slots` · `client/connection`（MIT）。  
> 产品落地包：`@xrkseek/web-runtime`（本笔记配套实现）。

---

## 0. 立场

| 不做 | 要做 |
|------|------|
| npm 整树 `@deepseek-ai/dsh-client-*` 当 UI 内核 | 抽 **规则** → 本仓测例锁死 → 自有 API |
| 复刻 Cordis Loader / SlotMap declare-merge 全集 | 先落地 **4 条算法** 够驱动 Face console → 真壳 |
| 客户端再 fold 业务投影 | **Host 算完、客户端只存**（projection 精华） |

---

## 1. 算法 A — Boot settle 门禁

### 上游

`AppWebEntry`：prefetch immediately → Loader entries → `await` → **全 fiber ACTIVE 扫表** → `settled=true` → `AppRoot` 一次切换；失败留加载页 + 逐项报告。

### 精华规则

1. 加载 UI **不依赖** 插件树（壳自给）。  
2. **全有或全无**：任一 entry 失败 → 不进真 UI。  
3. 状态是 `entryId → loading|active|failed|pending` 投影。

### XRK 自研

`BootGate`：`mark(id, state)` · `settle()` 当全部 active · `fail(report)` · `subscribe`。  
不绑 Cordis；apps/web / 未来壳共用。  
产品接线：[xrk-app-shell.md](./xrk-app-shell.md)（BootComposition 花名册 + chrome）。

---

## 2. 算法 B — higher-seq-wins 投影仓

### 上游

`ProjectionValueStore`：`key → { value, seq }`；`apply` 若 `seq <= row.seq` 则丢；`seed(baseline)` 同规则；`truncate(lastSeq)` 丢掉超过 durable 基线的行（防重连幽灵）。

### 精华规则

```text
apply(key, value, seq):
  if existing && seq <= existing.seq: drop
  else: store

seed(asOfSeq, values):
  for each key in values: apply(key, v, asOfSeq)
  for each stored key not in values:
    if row.seq <= asOfSeq: delete  // 能力在此 cut 缺失
```

客户端 **不做** 领域 fold；标题等由 Host Face 将来推 `session/projection`。

### XRK 自研

`ProjectionStore`（无 React）：同规则 + 测例锁死。Face mux 接到投影帧时调用。

---

## 3. 算法 C — Connection generation

### 上游

`ConnectionController.generation++` 每代连接；业务异步完成时若 generation 已变则 **吞掉**（防过期 open 污染新代）；断线 → `connection/reset` 清缓存。

### 精华规则

```text
let gen = 0
connect():
  gen += 1
  const my = gen
  ...
  onAsyncDone(result):
    if my !== gen: return  // stale
    apply(result)
```

指数退避：base/2..base 抖动，factor 增长，cap 上限。

### XRK 自研

`GenerationGuard`：`bump()` · `isCurrent(token)` · `run(fn)` 包装。  
WS 重连时 `bump()` + ProjectionStore.truncate / session 视图复位。

---

## 4. 算法 D — 流式 partial 累积（改造成 XRK 事件）

### 上游

`PartialAccumulator`：按 block index 稀疏数组；`text-delta` / `reasoning-delta` / `tool-call-delta`；`toPartial()` 压缩洞。

### XRK 现状

协议是 `assistant/chunk { text }` + 最终 `assistant/message`，**无** 六变体 StreamChunk。

### 转换（自研）

`ChunkFold`：

```text
on assistant/chunk: buffer += text; emit partial snapshot
on assistant/message: clear partial; emit final node
on tool/call | tool/result: append tool nodes
```

不假装有 block-index 协议；若未来要对齐 DeepSeek 流，再加适配层，**不污染** 本仓事件真源。

---

## 5. 算法 E — Slot 注册（完整 · 无 Cordis）

### 上游

`SlotKind = single|list|keyed|chain`；`order` 排序；list 无重复 id；声明合并 SlotMap；cascade dispose；priority shadowing；abdicate。

### XRK 自研

`SlotRegistry`（`@xrkseek/web-runtime`）：

- `define` / register `children` 声明（**无** `declare module` SlotMap）
- 四 kind 完整：single · list · keyed · chain（`electChain`）
- priority 阴影 · list `order` · store handle 单 scope · cascade dispose · `reportEntryError` abdicate
- 贡献类型泛型 `T`（函数/组件均可）；不绑 React

Face console 用 list slot `console.actions` 挂工具栏。  
AppShell 用 `chrome.sidebar` / `chrome.main` / `chrome.status` —— 见 [xrk-app-shell.md](./xrk-app-shell.md)。

---

## 6. 与本仓 Face / session 的接缝

| 算法 | 喂入 | 产出 |
|------|------|------|
| BootGate | 插件/bundle 加载 | apps/web 门禁 |
| ProjectionStore | Face mux `session/projection` + history `projections` | UI 读 get(key) |
| GenerationGuard | WS 重连 / FaceSessionView.attach | 丢弃过期 history/open |
| ChunkFold | Face mux `session/event` | 对话节点列表 |
| FaceSessionView | 上述组合 | console / 真壳会话面 |
| SlotRegistry | 壳插件注册 | 工具栏 / 面板贡献 |

`deriveMessages` 仍是 **模型可见** 真源；`session/title` 与 ChunkFold 均为旁路，不得写回模型窗。

---

## 7. 糟粕（明确不取）

- 客户端再实现一套 title/goal 领域 fold  
- 无 generation 的「随便重连叠状态」  
- 把 Effect / Cordis 引进 web-runtime  
- 为对齐上游而改 `@xrkseek/protocol` 事件形（应用适配层）——**例外**：log-only `session/title` 为本仓投影真源

---

## 8. 实现勾选

- [x] 本笔记  
- [x] `@xrkseek/web-runtime`：ProjectionStore · GenerationGuard · BootGate · ChunkFold  
- [x] apps/web Face console 改用 ChunkFold 渲染轨迹  
- [x] Face 推送投影帧 + ProjectionStore（`FaceSessionView`）  
- [x] `SlotRegistry` 四 kind 完整  
- [x] Face `session.rename` · title fallback · history/list `projections`

---

## 9. 参考

- Upstream：`projection-store.ts` · `partial.ts` · `connection.ts` · `boot.tsx` / `AppRoot.tsx` · `ui-slots` SlotCore · `session-projection`  
- 本仓：[../host-face.md](../host-face.md) · [protocol-events.md](../protocol-events.md) · [deepseek-web-ui.md](./deepseek-web-ui.md)
