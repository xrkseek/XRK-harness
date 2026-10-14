---
name: xrk-presence
description: >-
  支线 captions and presence_set mood. Use when updating session sideline tips,
  emotion ball mood, or when the user says 支线、表情球、心情、presence、tips.
  Dressing (hat/glasses/held) is skill xrk-presence-dressing.
---

# 支线 / presence_set

Tool: **`presence_set`** — only when it appears in your catalog (Face binds it on coding + Xiangyang; not on every surface). The tool description is the contract; this skill is the playbook.

## Product split

| Signal | Role |
|--------|------|
| **主线** | Session **title** when bound (`thread_upsert`) — lasting task name. |
| **`tips` / 支线** | Caption **under** the title in the sidebar. Current work. |
| **`emotionId`** | Optional Overview emotion ball. Accessory; Settings may hide it. |

**Ball off ≠ 支线 off.** `presence_set` / `sideline_set` still update sidebar 支线 when the emotion ball master switch is off. Update `tips` when work shifts — do not wait to be asked.

## Calls

```text
presence_set({ emotionId: "31", tips: "收到" })
presence_set({ emotionId: "30", tips: "梳理调用链" })
presence_set({ emotionId: "16", tips: "盯住这块" })
presence_set({ emotionId: "40", tips: "在读这块代码" })
presence_set({ emotionId: "33", tips: "搞定了" })
presence_set({ emotionId: "19", tips: "这样顺" })
presence_set({ emotionId: "34", tips: "测挂了，接着修" })
presence_set({ emotionId: "35", tips: "等你拍板" })
presence_set({ emotionId: "auto" })   # clear sticky mood only
```

- `tips` ≤ ~40 chars preferred (hard cap 200).
- Prefer the full catalog in the tool description — not only familiar ids.
- **Do not use `38`** to decline work (legacy reject face).
- Do not spam every sentence — update when the beat changes.

## Related

- 主线 pins: skill `xrk-thread-pin` (`thread_upsert` …).
- 装扮: skill `xrk-presence-dressing`.
