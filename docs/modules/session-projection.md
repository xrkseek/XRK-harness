# Session projection（状态 / 视图）

> **读者**：集成者 · 贡献者。

`@xrkseek/session-projection` 是投影**驱动缝**：领域注册纯折叠单元，Face（或其它载体）负责 mux / history。客户端**从不**自己 fold 事件——只收 wire 全量值。

对照 DSH `dsh-session-projection`（`dsh-v0.1.1-rc.1` 状态/视图分离）。本仓**无** Cordis `ctx.sessionProjections`；**无**持久 `session-projection-cache` 包（冷读 API 已在缝上预留）。

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
| `restoreFloor` · `viewCheckpoint` · `restore` | DSH 冷读阶梯（无 cache 包时仍可单测 / 将来接线） |
| `setSidecar` | Host 叠加（如 `goal`） |

Face 封装：`createFaceProjectionRegistry` ≡ `createSessionProjectionRegistry`。

## 载体

- mux：`session/projection`（key · value · seq；更高 seq 胜）
- RPC：`session.list` / `session.history` 带 `projections: { asOfSeq, values }`
- 客户端：`ProjectionValueStore` 只存成品值

## 相关

[server-face.md](./server-face.md) · [host-face.md](../host-face.md) · [status.md](../status.md) · stub `@xrkseek/xrk-session-projection`
