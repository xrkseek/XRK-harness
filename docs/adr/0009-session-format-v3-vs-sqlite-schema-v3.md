# ADR-0009: 第三方 Session Format V3 ≠ XRK SQLite schema v3

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-09-11
- **Tags:** session, persistence
- **Related:** [ADR-0002](./0002-no-embed-upstream.md) · [ADR-0003](./0003-session-long-loop-short.md) · [session.md](../session.md) · [session-latch.md](../session-latch.md) · [session-log.md](../session-log.md) · [status.md](../status.md)

## 背景

业界有一种会话 **逻辑格式世代**（常称 Session Format V3），配有 `SessionPersistence` / 逐会话 **`SessionHandle`**（单写者生命周期锁）。本仓持久化常量亦为 **`SCHEMA_VERSION = 3`**（`createPersistentSessionStore` · `sessions.db`）。数字同为 3，易被误当成同一契约。

## 差异

| 维度 | 第三方 Session Format V3 | XRK SQLite schema v3 |
|------|--------------------------|----------------------|
| **版本常量** | 逻辑格式世代号 | SQLite 物理 schema 号 |
| **句柄** | 打开通道级 `SessionHandle` 独占写 | 进程内 **turn** latch + store append/flush |
| **导出** | 格式世代 JSONL artifact | XRK 事件词表 `toJSONL` / packed ZIP |
| **迁移** | 逻辑世代边目录 | 库内 `schema_version` 升级（如重建 FTS） |

**名实**：同号「v3」分属不同层，不可互换；「schema v3 已上线」≠「已支持第三方 Session Format V3」。

## 决策

**不做。** 保持本仓 SQLite schema v3 与 `SessionStore`；不引入第三方 Format V3 磁盘契约，不实现 `SessionHandle` 式独占写锁作为产品持久化缝。

理由：

1. 会话真源与寿命已由 [ADR-0003](./0003-session-long-loop-short.md) 固定；持久化主路径已能跑。
2. 产品主路径以进程内 turn latch + SQLite flush 即可。
3. 禁止把外部 JSONL 世代规则抄进 `sessions.db` 契约（[ADR-0002](./0002-no-embed-upstream.md)）。

系统提示词保持 **出站组装**；不把渲染后的 system 升格写入会话 `system/message` 历史。

## 后果

- 文档须区分「SQLite schema v3」与「Session Format V3」。
- 集成者依赖本仓 `session.md` · `session-log.md`；勿假设可读第三方 Format artifact。
- status 将跨产品 Format 互通标为 **明确暂缓 · 未做**。

---

# ADR-0009: Third-party Session Format V3 ≠ XRK SQLite schema v3

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-09-11
- **Tags:** session, persistence
- **Related:** [ADR-0002](./0002-no-embed-upstream.md) · [ADR-0003](./0003-session-long-loop-short.md) · [session.md](../session.md) · [session-latch.md](../session-latch.md) · [session-log.md](../session-log.md) · [status.md](../status.md)

## Context

Some ecosystems ship a **logical session format generation** (often called Session Format V3) with `SessionPersistence` / per-session **`SessionHandle`** (single-writer lock). This repo’s persistence constant is also **`SCHEMA_VERSION = 3`**. Sharing the numeral invites conflating two contracts.

## Differences

| Dimension | Third-party Session Format V3 | XRK SQLite schema v3 |
|-----------|-------------------------------|----------------------|
| **Version constant** | Logical format generation | SQLite physical schema |
| **Handle** | Open-channel `SessionHandle` exclusive write | In-process **turn** latch + store append/flush |
| **Export** | Format-generation JSONL artifacts | XRK event vocabulary `toJSONL` / packed ZIP |
| **Migration** | Logical generation edge catalog | In-DB `schema_version` bump (e.g. rebuild FTS) |

**Naming:** the shared “v3” labels different layers — not interchangeable.

## Decision

**Do not adopt.** Keep SQLite schema v3 and `SessionStore`; do not take on third-party Format V3 on disk or `SessionHandle`-style exclusive locks as the product persistence seam.

System prompts stay **outbound assembly** only — not durable `system/message` history.

## Consequences

- Docs must distinguish “SQLite schema v3” from “Session Format V3”.
- Integrators rely on this repo’s session docs; do not assume third-party Format artifacts are readable.
- status lists cross-product Format interop as **Explicitly deferred · Not done**.
