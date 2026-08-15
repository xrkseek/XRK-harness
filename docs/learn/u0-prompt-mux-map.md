# U0 对照笔记：prompt / mux ↔ XRK（lc19）

> 吸收进规格后以 [../host-face.md](../host-face.md) 为准。本页保留对照过程摘要。

## 主路径

```text
UI conversation
  → session.prompt { mode: queue|steer, content[], rpcId }
  → Face: slash? → command : admit(delivery=mode) + wake drain
  → protocol: prompt/admitted → … → user/message (+ rpcId 对齐) → assistant/* → tool/*
  → mux: session/event* · session/queue · host/session-status(running)
  → UI fold 渲染
```

## 关键差异（已写入 host-face）

| 点 | DeepSeek | XRK | Face |
|----|----------|-----|------|
| 入队 | prompt 一次 | admit + turn/chat 拆分 | Face 内合成；禁阻塞 chat |
| 流 | 双 WS mux/host | SSE session_event | 实现 mux/host |
| seq | 事件序 | 无统一 seq | Face 分配单调 seq |
| 乐观 UI | user 事件带 rpcId | 无 | Face 旁路或协议扩展 |
| slash | prompt 内 `/` | slash recipes | 同槽，不进模型 |

## 闸门

- [x] 读 sessions.prompt / history / EventsApi  
- [x] 读本仓 http-api / session-api / protocol-events  
- [x] 写入 host-face.md  
- [x] DeepSeek `SessionEvent` 与本仓事件字段同构表（[face-event-isomorphism.md](./face-event-isomorphism.md)）
