# `@xrkseek/spill`

> **读者**：贡献者 · Host / agent-loop 维护者。

工具结果溢出（spill）的 **locator 契约**、本机存储、与策略层分离。

| 层 | 职责 |
|----|------|
| `SpillStore` / `LocalSpillStore` | 落盘、返回不透明 `SpillLocator` + `retrievalHint` |
| `applySpillPolicy` / `formatSpillNotice` | 何时溢出、inline 预览、模型可见 notice |
| `parseSpillLocator` | 从 pipeline / loop notice 解析路径（概况 Status 打开 spill） |

默认根目录：`{XRK_HOME}/spill`（工具结果在 `tool-outputs/`）。

---

> **Audience**: Contributors · Host / agent-loop maintainers.

**Locator contract**, local store, and policy layer for oversized tool results — storage ≠ policy.

| Layer | Role |
|-------|------|
| `SpillStore` / `LocalSpillStore` | Persist bytes; return opaque `SpillLocator` + `retrievalHint` |
| `applySpillPolicy` / `formatSpillNotice` | When to spill, inline preview, model-facing notice |
| `parseSpillLocator` | Parse path from pipeline / loop notices (Status “open spill”) |

Default root: `{XRK_HOME}/spill` (`tool-outputs/` for tool bodies).
