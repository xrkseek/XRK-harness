# `@xrkseek/session-format`

> **读者**：贡献者 · 会话持久化维护者。

相邻世代迁移链（学自 dsh `session-format`）+ 制品探测。**产品立场（[ADR-0009](../../docs/adr/0009-session-format-v3-vs-sqlite-schema-v3.md)）**：

| 缝 | 状态 |
|----|------|
| `xrk-interchange` | 角色 JSONL ↔ 事件（`importSessionInterchange`） |
| `xrk-sqlite-schema` | `sessions.db` 物理 schema，相邻 0→1→2→3 |
| `xrk-packed-jsonl` | 导出 packed 行 / `.jsonl.zst` |
| 第三方 Session Format V3 | **不采纳**；探测到则 `refused` |

互通 ≠ Format V3。

---

> **Audience**: Contributors · session persistence maintainers.

Adjacent migration chain (from dsh `session-format`) + artifact detect. **Product stance ([ADR-0009](../../docs/adr/0009-session-format-v3-vs-sqlite-schema-v3.md))**: interchange + SQLite schema edges are first-class; third-party Session Format V3 is **not** adopted. Interop ≠ Format V3.
