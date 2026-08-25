# Session 安全（mistake · loop）

> **读者**：集成者 · 贡献者

Session 旁路，**不**写进 `runTurn` 内核。见 [ADR-0003](./adr/0003-session-long-loop-short.md)。

## 组件

| 组件 | 默认 | 行为 |
|------|------|------|
| **LoopDetection** | soft=3 · hard=5 | 同名+同参连打；soft/hard → 耐久 `safety/notice`；hard → deny + mistake `forceAtLimit` + 可中止 turn |
| **MistakeTracker** | max=6 | **turn 结束**时：全工具失败 +1；有成功则清零；触顶 → `SessionSafetyLimitError` + `safety/notice` |

## 事件

本仓用 **`safety/notice`**（非普通 user 文本）承载 recovery：

| kind | 含义 |
|------|------|
| `loop_soft` | 刚好撞 soft 阈值 |
| `loop_hard` | hard 环中止 |
| `mistake_limit` | 连续失败触顶 |
| `api_error` | （预留）API 失误触顶时的日志 |

`deriveMessages` 把 `safety/notice` **投影为** `role: user`（兼容 LLM API），但日志里仍可按 `type`/`kind` 过滤「非人类注入」。

## 接线

- Tracker：`@xrkseek/core-session`（`createSessionSafety`）
- Pipeline：`createAgent` — soft/hard → `addSafetyNotice` → loop batch 写 `safety/notice`
- hard abort：`consumeAbortMessage()`，避免仅靠 AbortError 后猜测文案

## HTTP

触顶 → **`409`** `{ "error": "safety limit", "reason": "…" }`

## 配置

```ts
createAgent({
  safety: {
    loopDetection: { softThreshold: 3, hardThreshold: 5 }, // or false
    mistake: { maxConsecutiveMistakes: 6, onLimit: "stop" },
  },
});
```

---

# Session Safety (mistake · loop)

> **Audience**: Integrators · Contributors

A session-side path that is **not** inside the `runTurn` kernel. See [ADR-0003](./adr/0003-session-long-loop-short.md).

## Components

| Component | Default | Behavior |
|------|------|------|
| **LoopDetection** | soft=3 · hard=5 | Same name + same args repeated; soft/hard → durable `safety/notice`; hard → deny + mistake `forceAtLimit` + may abort the turn |
| **MistakeTracker** | max=6 | At **turn end**: all tools failed → +1; any success → reset; at limit → `SessionSafetyLimitError` + `safety/notice` |

## Events

This repository uses **`safety/notice`** (not ordinary user text) for recovery:

| kind | Meaning |
|------|------|
| `loop_soft` | Soft threshold hit |
| `loop_hard` | Hard loop abort |
| `mistake_limit` | Consecutive failure limit |
| `api_error` | (Reserved) log when API mistakes hit a limit |

`deriveMessages` projects `safety/notice` as `role: user` for LLM API compatibility; the log still filters non-human injects by `type`/`kind`.

## Wiring

- Tracker: `@xrkseek/core-session` (`createSessionSafety`)
- Pipeline: `createAgent` — soft/hard → `addSafetyNotice` → loop batch writes `safety/notice`
- Hard abort: `consumeAbortMessage()`, so copy is not guessed from AbortError alone

## HTTP

At limit → **`409`** `{ "error": "safety limit", "reason": "…" }`

## Configuration

```ts
createAgent({
  safety: {
    loopDetection: { softThreshold: 3, hardThreshold: 5 }, // or false
    mistake: { maxConsecutiveMistakes: 6, onLimit: "stop" },
  },
});
```
