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
- 集成者依赖本仓 `session.md` · `session-log.md`。角色 JSONL 可经 `importSessionInterchange` / `exportSessionInterchange` 换成 XRK 事件，**不**写入 `sessions.db`，也**不是** Session Format V3。
- `@xrkseek/session-format` 提供相邻迁移链（sqlite schema 0→1→2→3）与制品探测；探测到第三方 Format 头则拒绝（`refused`），保持 **互通 ≠ V3**。

## 旧档等价处理（schema 0/1/2）

自研物理 schema 的世代升级是**就地、打开时**的相邻迁移（`migrateSqliteSchema`，`@xrkseek/session-format` 的 `sqlite-schema.ts`；边 `0→1` 建表 · `1→2` 建 FTS · `2→3` 重建 FTS）。等价处理规则：

- **写者打开**（`createPersistentSessionStore` 未 `shared`）：`initSchema` 读 `meta.schema_version`，`stored ≥ current` 时幂等 `ensureTables + ensureFts` 直接可用；否则沿相邻链就地升到 current 并写回版本戳。`stored > current`（新于本构建）由链的 `plan` 抛 `SessionFormatUnsupportedMigrationError`，**不静默降级**。
- **读取级兼容**：升级不重写历史 `events` 行；旧行在 load 时经 `parseStoragePayload`（打包行展开 / 事件断言）逐行解释，坏行**截断**该会话（`loadSessionEvents` 遇错 `break`），不整库拒绝。turn-end 后旧档的等价物就是**同一批事件行在 v3 表里的现状读取**。
- **`{ shared: true }` 只读打开不迁移**：跳过写租约、`node:sqlite` 只读打开、`initSchema` 不执行（见 `session.md` 目录级写锁一节）。旁路读者看到的 schema 即磁盘现状。
- **第三方 Format V3 仍拒绝**：探测到逻辑世代头（`foreign-session-format`）→ `refused`，不迁移、不抄写；跨产品角色 JSONL 只能经 `importSessionInterchange`。



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
- Integrators rely on this repo’s session docs. Role JSONL can be translated with `importSessionInterchange` / `exportSessionInterchange` into XRK events. That translation is **not** written into `sessions.db` and is **not** Session Format V3.
- `@xrkseek/session-format` owns the adjacent migration chain (sqlite schema 0→1→2→3) and artifact detect; foreign Format headers are refused — **interop ≠ V3**.

## Legacy-file handling (schema 0/1/2)

Own-schema generation bumps are **in-place, open-time, adjacent** migrations (`migrateSqliteSchema`, `@xrkseek/session-format` `sqlite-schema.ts`; edges `0→1` create tables · `1→2` create FTS · `2→3` rebuild FTS). Equivalent handling rules:

- **Writer open** (`createPersistentSessionStore` without `shared`): `initSchema` reads `meta.schema_version`; `stored ≥ current` → idempotent `ensureTables + ensureFts` and open normally; otherwise migrate in place along the adjacent chain to current and write the version stamp back. `stored > current` (newer than this build) throws `SessionFormatUnsupportedMigrationError` from the chain `plan` — **no silent downgrade**.
- **Read-level compatibility:** upgrade does not rewrite historical `events` rows; old rows are interpreted row-by-row at load via `parseStoragePayload` (packed-row expand / event assertion), and a bad row **truncates** that session (`loadSessionEvents` `break`s on error) rather than rejecting the whole DB. After turn-end, the post-upgrade equivalent of an old file is simply the same event rows read as-is under v3.
- **`{ shared: true }` read-only open does not migrate:** skips the write lease, opens `node:sqlite` read-only, and skips `initSchema` (see the directory-level write-lock section in `session.md`). A sidecar reader sees whatever schema is on disk.
- **Third-party Format V3 is still refused:** a detected logical-generation header (`foreign-session-format`) is `refused`, not migrated or transcribed; cross-product role JSONL only enters via `importSessionInterchange`.
