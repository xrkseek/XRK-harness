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
| `session.list`（冷） | list-checkpoint 文件列；miss 则仅 `listHints` |
| `session.history` 尾页 | 轻量 meter/stats · **`turnOutline`** + `contextTimeline` / `contextHeaders` |
| `session.history` + `beforeSeq` | **无** `projections` 块 |
| SQLite LRU 淘汰 | 先写 list checkpoint，再 `evictSession` |

## Face 默认键：`turnOutline`

整段日志的轮次阶梯，供壳侧聊天轨（rail）跳转。客户端**不**从已加载窗口自己拼完整阶梯——只消费 wire 全量值。

| 字段 | 含义 |
| --- | --- |
| `turn` | Face wire 轮次号（首次见到的 `turnId` 顺序，从 **1** 起） |
| `seq` | 该轮 `turn/start` 的 Face seq（`Session.loadThrough(seq)` 目标） |
| `prompt` | 首条人类提示预览（有界；空串 = 尚未落地） |
| `response` | 终稿回复预览（有界；空串 = 尚未在 `turn/end` 提交） |

推送纪律：

| 事件 | mux `session/projection` · `turnOutline` |
| --- | --- |
| `turn/start` | 推：新阶梯项（`prompt`/`response` 为空） |
| 首条 human `user/message` | 推：填入 `prompt` |
| `assistant/message` | **不推**（host-only draft；同引用保静默） |
| `turn/end` | 推：提交 `response` |

载体：`session.history` **尾页**基线 + live mux。`beforeSeq` 的 loadOlder 页**不**带 `projections`。键类型在 `@xrkseek/xrk-host-apiproxy`（`TurnOutlineEntry`）；壳包镜像 declare-merge 供 tsc emit。

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
| `session.list` (cold) | list-checkpoint file column; miss → `listHints` only |
| `session.history` tail | light meter/stats · **`turnOutline`** + `contextTimeline` / `contextHeaders` |
| `session.history` with `beforeSeq` | **no** `projections` block |
| SQLite LRU eviction | write list checkpoint, then `evictSession` |

## Face default key: `turnOutline`

Whole-log turn ladder for the shell chat rail. Clients do **not** rebuild the full ladder from a paged window — they only consume finished wire values.

| Field | Meaning |
| --- | --- |
| `turn` | Face wire turn number (order of first-seen `turnId`; starts at **1**) |
| `seq` | Face seq of that turn's `turn/start` (`Session.loadThrough(seq)` target) |
| `prompt` | First human-prompt preview (bounded; `''` until landed) |
| `response` | Final response preview (bounded; `''` until committed at `turn/end`) |

Push rules:

| Event | mux `session/projection` · `turnOutline` |
| --- | --- |
| `turn/start` | Push: new ladder entry (`prompt`/`response` empty) |
| First human `user/message` | Push: fill `prompt` |
| `assistant/message` | **No push** (host-only draft; same reference stays quiet) |
| `turn/end` | Push: commit `response` |

Carriers: `session.history` **tail** baseline + live mux. loadOlder pages with `beforeSeq` omit the whole `projections` block. Wire type: `@xrkseek/xrk-host-apiproxy` (`TurnOutlineEntry`); shell packages mirror declare-merge for tsc emit.

## Related

[server-face.md](./server-face.md) · [host-face.md](../host-face.md) · [status.md](../status.md) · stub `@xrkseek/xrk-session-projection`
