---
name: xrk-thread-pin
description: >-
  Workspace 主线 catalog semantics. Use when minting, revising, listing or deleting
  a 主线 pin so peers can discover this work, or when pinning a session you opened
  elsewhere (`thread_upsert` with session_id). Messaging (`thread_message`) does
  not require a pin. Not for 支线 captions.
---

# 主线（thread pin）

主线是 **AI 拥有的协作发现 pin**，不是用户的原话，也**不是**发信门槛。  
目的：让同工作区（或你指定的工作区）里的兄弟会话在 collab board / `thread_list` 上**迅速锁定**可协作对象与运行态。  
跨会话派任务用 `thread_message`（或编排面的 `workspace_session_prompt`）——**双方都不必先挂主线**。

## 起手

```
thread_upsert({ title, brief, switch? })                 # 给本会话钉 pin
thread_upsert({ title, brief, session_id, workspace_id }) # 给别处开会话钉 pin（向阳 / IM / 编码编排）
thread_upsert({ id, title, brief })                      # revise，不新建
thread_delete({ id })                                    # 任务结束且不再需要被找到
thread_list({ workspace_id? })                           # 看 catalog；可看别的工作区
```

- `title` = 短的**任务名**；`brief` = 让兄弟一眼看懂的一两句。
- `switch: true`（默认）把目标会话绑上去，**侧栏标题变成这个 pin**。
- 只有 one-shot Q&A 不建。UI fork 会继承父会话主线，不要丢。

## Catalog 语义

| 调用 | 看到什么 |
|------|----------|
| `thread_list` | 指定工作区（默认本区）的 catalog + **已绑定**父会话。未绑定的不出现。 |
| `thread_upsert` | 用 `id` 改既有 pin；`session_id` 可钉别的父会话（须属于该 `workspace_id`）。 |

## 会话之间怎么协作

| 路径 | 用途 |
|------|------|
| `thread_message({ session_id, message })` | 任意父会话互发（可跨工作区）；steer；默认等回复回传。**不要求主线。** |
| `workspace_session_prompt` | 在编码工作区**新建/续用**会话并派第一句（返回 `sessionId`）；默认等回复。 |
| `session_search` / `session_read` | 字面检索未上主线的会话、回顾历史（不可信内容）。 |

**不要**为了寄信用 `thread_switch` —— 那会改本会话侧栏钉。

## 别做的

- 把主线当日志 / 进度板（进度是 `todo_write`，caption 是 `presence_set` `tips` = 支线）。
- 每个子任务建一条主线 —— 一件工作一条。
- 以为没主线就不能协作 —— 主线只是发现加速器。

**支线**（`sideline_set` / `presence_set` `tips`）是同一会话的状态说明 — playbook: skill `xrk-presence`。Agent Team 不编辑主线；两者是不同面。
