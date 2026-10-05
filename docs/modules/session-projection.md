# Session projection（状态 / 视图）

> **读者**：集成者 · 贡献者

`@xrkseek/session-projection` 是投影**驱动缝**：领域注册纯折叠单元，Face（或其它载体）负责 mux / history。客户端**从不**自己 fold 事件——只收 wire 全量值。

本仓**无** Cordis `ctx.sessionProjections`。Face 为冷 `session.list` 持久化 **list-tier** checkpoint（`{sessionsDir}/projection-list-cache.json`）；全量 durable projection-cache 包仍可选。

## 双表

| 表 | 谁合并 | 谁读 |
| --- | --- | --- |
| `SessionProjectionMap` | 客户端 stub / Face declare-merge | mux · history · React |
| `SessionProjectionStateMap` | host 单元（可选） | 仅 `stateOf` / `checkpoint` |

Host-only 键只进 StateMap（单元省略 `wire`）——`snapshot` / `onChanged` **不**发出。

## 单元

```ts
ProjectionDefinition = {
  key, stateVersion,
  init(), apply(state, event),  // 同引用 = 无下游
  wire?: { view(state), parse(value) },  // 省略 = host-only
}
```

Face 默认单元（`packages/server/face/src/projections/units`）一律带 `wire`。内部字段（如 title `pinned`、tokenUsage `last`）留在 state，`view` 只出客户端需要的切片。

## 注册表 API

| 方法 | 作用 |
| --- | --- |
| `register` / `onChanged` | 注册 · 变更流（仅 wired） |
| `drive(sessionId, event, seq)` | Face 在 `session/event` 同 seq 后驱动 |
| `snapshot` | 一致切面：wired + sidecar；`asOfSeq` = 日志长度（空为 `-1`） |
| `stateOf` | 借读 host 态；未注册 → `undefined` |
| `checkpoint` | 全部单元状态（含 host-only），供缓存写侧 |
| `restoreFloor` · `viewCheckpoint` · `restore` | 冷读阶梯 |
| `setSidecar` | Host 叠加（如 `goal`） |
| `evictSession` | 丢弃内存 cell（SQLite LRU） |

Face 封装：`createFaceProjectionRegistry` ≡ `createSessionProjectionRegistry`。

## 载体

- mux：`session/projection`（key · value · seq；更高 seq 胜）
- RPC：`session.list` / `session.history` 带 `projections: { asOfSeq, values }`
- 客户端：`ProjectionValueStore` 只存成品值

## Face 投影分层（Codex 式）

| 载体 | 预算 |
| --- | --- |
| `session.list`（已加载） | `title` · `sessionListMetadata` |
| `session.list`（冷） | list-checkpoint 文件列；miss / 解析残缺 → 仅 `listHints`（禁止静默半截错状态） |
| `session.history` 尾页 | 轻量 meter/stats · **`turnOutline`** · **`workspaceChanges`** + `contextTimeline` / `contextHeaders` |
| `session.history` + `beforeSeq` | **无** `projections` 块 |
| SQLite LRU 淘汰 | 先 remember list checkpoint（磁盘 I/O best-effort，内存行保留），再 `evictSession`；remember 失败则跳过淘汰 |

## Face 默认键：`turnOutline`

整段日志的轮次阶梯，供壳侧聊天轨（rail）跳转。客户端**不**从已加载窗口自己拼完整阶梯——只消费 wire 全量值。

| 字段 | 含义 |
| --- | --- |
| `turn` | Face wire 轮次号（**整段日志**首次见到的 `turnId` 顺序，从 **1** 起；跳转键，不是用户看到的第 N 轮）。`session.history` 接线任何一页之前按全日志预分配，尾页先到不得把后出现的 turn 编成 1 |
| `round` | 已发布 opener 上的无空隙 轮次（从 **1** 起）。空 prompt 的 Host turn 不占号 |
| `seq` | 该轮 `turn/start` 的 Face seq（`Session.loadThrough(seq)` 目标） |
| `prompt` | 首条人类提示预览（有界） |
| `response` | 终稿回复预览（有界；空串 = 尚未在 `turn/end` 提交） |

推送纪律：

| 事件 | mux `session/projection` · `turnOutline` |
| --- | --- |
| `turn/start` | 折叠入空 Host 项；**不**发布 轮次（视图仍是已有 opener 列表，常为 `[]`）。fold 引用变化仍可能推一帧 |
| 首条 human `user/message` | 推：新 轮次（填 `prompt` + `round`） |
| `assistant/message` | **不推**（host-only draft；同引用保静默） |
| `turn/end` | 推：提交 `response` |

壳侧聊天轨合并整段阶梯后，导航器露出最多 **10** 个相机刻度；不在最新一轮时再钉一根第 **11** 格（会话最新一轮，点回底部）。阅读位最长，最新一轮（轨底）中长（正在读最新则只显示长），其余短。

载体：`session.history` **尾页**基线 + live mux。`beforeSeq` 的 loadOlder 页**不**带 `projections`。键类型在 `@xrkseek/xrk-host-apiproxy`（`TurnOutlineEntry`）；壳包镜像 declare-merge 供 tsc emit。

## Face 默认键：`workspaceChanges`

整段日志的回合改动摘要（Overview `#改动`）。冷打开靠 history 尾页基线 fold；live mux 同 turnId 后写覆盖。对话 turnTail **另**从事件嵌入摘要 fold 改动卡（与投影并行）；Overview 在投影为空时回退 conversation timeline。逐文件 hunk 走 Face unary `changes.fileDiff`（重建失败返回 `null` → 壳文案「内容已不可用」）。

## 相关

[server-face.md](./server-face.md) · [host-face.md](../host-face.md) · [status.md](../status.md) · stub `@xrkseek/xrk-session-projection`

---

# Session projection (state / view)

> **Audience**: Integrators · Contributors

`@xrkseek/session-projection` is the projection **drive seam**: the domain registers pure fold units; Face (or another carrier) owns mux / history. Clients **never** fold events themselves — they only receive full wire values.

This repo has **no** Cordis `ctx.sessionProjections`. Face persists a **list-tier** checkpoint file (`projection-list-cache.json`) for cold `session.list`; a full durable projection-cache package remains optional.

## Dual maps

| Map | Who merges | Who reads |
| --- | --- | --- |
| `SessionProjectionMap` | Client stub / Face declare-merge | mux · history · React |
| `SessionProjectionStateMap` | Host units (optional) | `stateOf` / `checkpoint` only |

Host-only keys go only into StateMap (unit omits `wire`) — `snapshot` / `onChanged` do **not** emit them.

## Units

```ts
ProjectionDefinition = {
  key, stateVersion,
  init(), apply(state, event),  // same reference = no downstream
  wire?: { view(state), parse(value) },  // omit = host-only
}
```

Face default units (`packages/server/face/src/projections/units`) always carry `wire`. Internal fields (e.g. title `pinned`, tokenUsage `last`) stay in state; `view` emits only the client slice.

## Registry API

| Method | Role |
| --- | --- |
| `register` / `onChanged` | Register · change stream (wired only) |
| `drive(sessionId, event, seq)` | Face drives after `session/event` at the same seq |
| `snapshot` | Consistent cut: wired + sidecar; `asOfSeq` = log length (empty = `-1`) |
| `stateOf` | Borrow host state; unregistered → `undefined` |
| `checkpoint` | All unit state (including host-only) for cache write side |
| `restoreFloor` · `viewCheckpoint` · `restore` | Cold-read ladder |
| `setSidecar` | Host overlay (e.g. `goal`) |
| `evictSession` | Drop in-memory cells (SQLite LRU) |

Face wrapper: `createFaceProjectionRegistry` ≡ `createSessionProjectionRegistry`.

## Carriers

- mux: `session/projection` (key · value · seq; higher seq wins)
- RPC: `session.list` / `session.history` with `projections: { asOfSeq, values }`
- Client: `ProjectionValueStore` stores finished values only

## Face projection tiers (Codex-style)

| Carrier | Budget |
| --- | --- |
| `session.list` (loaded) | `title` · `sessionListMetadata` |
| `session.list` (cold) | list-checkpoint file column; miss / corrupt parse → `listHints` only (never partial silent wrong) |
| `session.history` tail | light meter/stats · **`turnOutline`** · **`workspaceChanges`** + `contextTimeline` / `contextHeaders` |
| `session.history` with `beforeSeq` | **no** `projections` block |
| SQLite LRU eviction | remember list checkpoint (I/O best-effort, in-memory retained), then `evictSession`; remember failure skips eviction |

## Face default key: `turnOutline`

Whole-log turn ladder for the shell chat rail. Clients do **not** rebuild the full ladder from a paged window — they only consume finished wire values.

| Field | Meaning |
| --- | --- |
| `turn` | Face wire turn number (order of first-seen `turnId` in the **whole log**; starts at **1**; jump key, not the user-facing 轮次). `session.history` primes those numbers from the full log before wiring any page, so a tail-first open cannot renumber later turns as 1 |
| `round` | Gapless 轮次 among published openers (starts at **1**). Host turns with no opener do not occupy a number |
| `seq` | Face seq of that turn's `turn/start` (`Session.loadThrough(seq)` target) |
| `prompt` | First human-prompt preview (bounded) |
| `response` | Final response preview (bounded; `''` until committed at `turn/end`) |

Push rules:

| Event | mux `session/projection` · `turnOutline` |
| --- | --- |
| `turn/start` | Fold an empty Host row; **do not** publish a 轮次 (view stays the existing opener list, often `[]`). A fold-reference change may still push a frame |
| First human `user/message` | Push: new 轮次 (`prompt` + `round`) |
| `assistant/message` | **No push** (host-only draft; same reference stays quiet) |
| `turn/end` | Push: commit `response` |

The shell merges the full ladder, then the navigator shows at most **10** camera ticks and, when the reader is not on the newest 轮次, pins an **11th** floor tick (session newest; click returns to the bottom). The reading mark is longest; the floor (newest) is medium unless it is also the reading mark; every other mark stays short.

Carriers: `session.history` **tail** baseline + live mux. loadOlder pages with `beforeSeq` omit the whole `projections` block. Wire type: `@xrkseek/xrk-host-apiproxy` (`TurnOutlineEntry`); shell packages mirror declare-merge for tsc emit.

## Face default key: `workspaceChanges`

Whole-log turn change summaries (Overview `#Changes`). Cold reopen folds from the history-tail baseline; live mux last-write-wins per turnId. Chat turnTail **also** folds embedded `workspace/changes` summaries (parallel to the projection); Overview falls back to the conversation timeline when the projection is empty. Per-file hunks via Face unary `changes.fileDiff` (`null` when rebuild fails → shell “no longer available” copy).

## Related

[server-face.md](./server-face.md) · [host-face.md](../host-face.md) · [status.md](../status.md) · stub `@xrkseek/xrk-session-projection`
