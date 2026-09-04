# Session 日志读取面

> **读者**：集成者 · 贡献者

Session 真源是 append-only 事件日志。本页说明日志位置类型与读取 API。

总览：[session.md](./session.md)。压缩 / meter：[session-compaction.md](./session-compaction.md)。Face mux：[host-face.md](./host-face.md)。

## 分层

| 层 | 包 | 职责 |
|----|-----|------|
| 事件样本 | `@xrkseek/protocol` | `SessionEvent` · `providerUsageSample` / `usageFromSessionEvent` |
| 日志与计价 | `@xrkseek/core-session` | Store · 位置品牌 · `readEvents` · `deriveMessages` · 预算 `estimateTokens` · meter `foldSurfaceTokens` / `priceCurrentSurfaceWindow` |
| Turn / 压缩写入 | `@xrkseek/core-agent-loop` | `runTurn` · `runCompaction`（写入 `shadowedTokenCount`）· `request/header` |
| Agent 门面 | `@xrkseek/core-agent` | Latch · admit · `compactNow` |
| Face 投影 | `@xrkseek/server-face` | `tokenUsage` · `contextPressure` · `contextBreakdown` · `sessionStats`（只投影，不计价） |

预算估价与 Context meter 是两条路径：前者选 `recent` / 触发压缩；后者 fold 当前窗口表面。细节见 [session-compaction.md](./session-compaction.md)。

## 位置类型

运行时仍是普通 `number`；类型上区分角色：

| 类型 / 构造 | 含义 |
|-------------|------|
| `SessionSeq(n)` | 已存在事件下标（`0 .. length-1`） |
| `SessionLogOffset(n)` | 缺口、前缀长度、半开端点（可为 `length`） |
| `SessionSeqCursor(n)` | 水位：`-1`（空日志）或已有 `SessionSeq` |

非法值（负零、小数、超出 safe integer）在构造或 `resolveHalfOpenEventRange` 时抛 `TypeError`。

Face mux 使用独立的 `FaceMuxSeq`（见 [host-face.md](./host-face.md)），与日志下标无关。

## 读取 API

半开区间均为 `[from, to)`，越界语义同 `Array.prototype.slice`。全量读（`from === 0 && to === length`）复用驻留数组引用；区间读返回新切片。事件在 `append` 时深冻。

### Store（默认入口）

| API | 作用 |
|-----|------|
| `store.readEvents(id, from?, to?)` | 仓必选；冷会话水合 |
| `readSessionEvents(store, id, from?, to?)` | 品牌默认值的封装，委托 `readEvents` |
| `sessionEventCount` / `sessionEventAt` / `lastSessionEvent` / `sessionEventsFrom` | 长度、单条、末条、后缀 |
| `computeListHints` / `sessionListHints` | 列表元数据（`lastEventTs` · `hasTurnStart`）；优先 `store.listHints` |

`SessionLogReader` = `Pick<SessionStore, "readEvents">`。

### Record（已持有 `SessionRecord`）

| API | 作用 |
|-----|------|
| `snapshotEvents` / `eventAt` / `eventCount` | 区间快照、下标、长度 |
| `resolveHalfOpenEventRange` | 半开端点规范化（仓实现共用） |

```ts
import {
  SessionLogOffset,
  SessionSeq,
  SessionSeqCursor,
  lastSessionEvent,
  readSessionEvents,
  sessionEventCount,
  sessionEventsFrom,
} from "@xrkseek/core-session";

const n = sessionEventCount(store, sessionId);
const page = readSessionEvents(store, sessionId, SessionLogOffset(0), SessionLogOffset(50));
const delta = sessionEventsFrom(store, sessionId, n);
const tip = lastSessionEvent(store, sessionId);
const cursor = SessionSeqCursor(-1);
```

`forkSession` 用 `readSessionEvents` 取前缀再 `append`。会话是否存在用 `store.has`。不依赖 `core-session` 的叶包可 duck-type `readEvents`，否则读 `get().events`。

## 持久化仓

`createPersistentSessionStore`：打开时懒加载会话 id；`get` / `readEvents` 时水合事件。`eventsRef(id)` 返回已驻留数组。列表元数据走 `listHints`。驻留 LRU 默认上限 8；**未闭合 turn 不驱逐**（可临时超上限）。淘汰前 `flush` chunk 批，再通知 Face checkpoint。

物理行可为 `text-chunks` / `tool-call-chunks`；展开后的事件下标与磁盘 `seq` 不同，因此区间读在冷 miss 时先水合全文再切片。耐久屏障是 `flush()`（见 [session.md](./session.md)）。

## 与压缩 / meter

换窗后 `deriveMessages` 从最新 `context/compaction` 重建模型可见历史。Context meter 经 `foldSurfaceTokens` / `priceCurrentSurfaceWindow` 计价当前窗口；`shadowedTokenCount` 有则按「摘要价 − 该值」调整。见 [session-compaction.md](./session-compaction.md)。

---

# Session Log Read Surface

> **Audience**: Integrators · Contributors

The Session source of truth is an append-only event log. This page covers position types and the read API.

Overview: [session.md](./session.md). Compaction / meter: [session-compaction.md](./session-compaction.md). Face mux: [host-face.md](./host-face.md).

## Layers

| Layer | Package | Role |
|-------|---------|------|
| Event samples | `@xrkseek/protocol` | `SessionEvent` · `providerUsageSample` / `usageFromSessionEvent` |
| Log + pricing | `@xrkseek/core-session` | Store · position brands · `readEvents` · `deriveMessages` · budget `estimateTokens` · meter `foldSurfaceTokens` / `priceCurrentSurfaceWindow` |
| Turn / compaction write | `@xrkseek/core-agent-loop` | `runTurn` · `runCompaction` (writes `shadowedTokenCount`) · `request/header` |
| Agent façade | `@xrkseek/core-agent` | Latch · admit · `compactNow` |
| Face projection | `@xrkseek/server-face` | `tokenUsage` · `contextPressure` · `contextBreakdown` · `sessionStats` (project only; no pricing) |

Budget estimation and the Context meter are separate paths: the former picks `recent` / triggers compaction; the latter folds the current window surface. Details: [session-compaction.md](./session-compaction.md).

## Position types

Runtime values remain plain `number`s; the type system separates roles:

| Type / ctor | Meaning |
|-------------|---------|
| `SessionSeq(n)` | Index of an existing event (`0 .. length-1`) |
| `SessionLogOffset(n)` | Gap, prefix length, or half-open endpoint (may equal `length`) |
| `SessionSeqCursor(n)` | Watermark: `-1` (empty log) or an existing `SessionSeq` |

Invalid values (negative zero, fractions, beyond safe integer) throw `TypeError` at construction or in `resolveHalfOpenEventRange`.

Face mux uses a separate `FaceMuxSeq` (see [host-face.md](./host-face.md)); it is not a log index.

## Read APIs

Ranges are half-open `[from, to)`; out-of-range behavior matches `Array.prototype.slice`. Full-range reads (`from === 0 && to === length`) reuse the resident array reference; ranged reads return a fresh slice. Events are deep-frozen on `append`.

### Store (default entry)

| API | Role |
|-----|------|
| `store.readEvents(id, from?, to?)` | Required on every store; hydrates cold sessions |
| `readSessionEvents(store, id, from?, to?)` | Branded defaults; delegates to `readEvents` |
| `sessionEventCount` / `sessionEventAt` / `lastSessionEvent` / `sessionEventsFrom` | Length, one event, tail, suffix |
| `computeListHints` / `sessionListHints` | List metadata (`lastEventTs` · `hasTurnStart`); prefers `store.listHints` |

`SessionLogReader` = `Pick<SessionStore, "readEvents">`.

### Record (when you already hold a `SessionRecord`)

| API | Role |
|-----|------|
| `snapshotEvents` / `eventAt` / `eventCount` | Snapshot, index, length |
| `resolveHalfOpenEventRange` | Shared half-open normalization |

```ts
import {
  SessionLogOffset,
  SessionSeq,
  SessionSeqCursor,
  lastSessionEvent,
  readSessionEvents,
  sessionEventCount,
  sessionEventsFrom,
} from "@xrkseek/core-session";

const n = sessionEventCount(store, sessionId);
const page = readSessionEvents(store, sessionId, SessionLogOffset(0), SessionLogOffset(50));
const delta = sessionEventsFrom(store, sessionId, n);
const tip = lastSessionEvent(store, sessionId);
const cursor = SessionSeqCursor(-1);
```

`forkSession` copies a prefix via `readSessionEvents` then `append`. Existence checks use `store.has`. Leaf packages without a `core-session` dependency may duck-type `readEvents`, else read `get().events`.

## Persistent store

`createPersistentSessionStore` lazy-loads session ids on open and hydrates on `get` / `readEvents`. `eventsRef(id)` returns the resident array. List metadata uses `listHints`. Resident LRU defaults to 8; **open turns are never evicted** (the set may temporarily exceed the cap). Eviction flushes chunk batches, then notifies Face for checkpoints.

Physical rows may be `text-chunks` / `tool-call-chunks`; expanded event indices differ from disk `seq`, so cold range reads hydrate the full log then slice in memory. Durability barrier: `flush()` (see [session.md](./session.md)).

## Compaction / meter

After windowing, `deriveMessages` rebuilds model-visible history from the latest `context/compaction`. The Context meter prices the current window via `foldSurfaceTokens` / `priceCurrentSurfaceWindow`; when `shadowedTokenCount` is present it adjusts by “summary price − that value”. See [session-compaction.md](./session-compaction.md).
