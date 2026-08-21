# @xrkseek/core-session

Append-only session log, `deriveMessages()`, model-visible invariant, and execution latches.

## Invariant

**Model-visible ≡ Logged** — anything sent to the model must be reconstructible from session events.

## Latches

- `createTurnLatch` — exclusive turn; busy → `SessionBusyError`（wired into `createAgent`）
- `createSessionDrainLatch` / `createSessionDrainHub` — `run` / `wake` / `cancel`（host admit wake/resume）

See [docs/session-latch.md](../../../docs/session-latch.md), [docs/session-api.md](../../../docs/session-api.md), [docs/session-delivery.md](../../../docs/session-delivery.md), [docs/session-safety.md](../../../docs/session-safety.md), [docs/session-compaction.md](../../../docs/session-compaction.md), [docs/protocol-events.md](../../../docs/protocol-events.md), and [docs/tool-settlement.md](../../../docs/tool-settlement.md).

## Compaction / meter

| File | Role |
|------|------|
| `compaction.ts` | Window helpers · budget `estimateTokens` / `estimateMessagesTokens` |
| `surface-estimate.ts` | Heuristic pricing for text, blocks, toolCalls, system, tools |
| `surface-fold.ts` | `foldSurfaceTokens` · `priceCurrentSurfaceWindow` |
| `request-header.ts` | `foldRequestHeader` · reconstructable LLM envelope |

See [docs/session-compaction.md](../../../docs/session-compaction.md).

## Store

`createMemorySessionStore` — `append` runs `assertSessionEvent` then deep-freeze. `has(id)` 不抛。  
`createPersistentSessionStore(dir)` — 工作区 `{dir}/sessions.db`（WAL · **schema v3** · `node:sqlite` · FTS5 trigram · lazy load · chunk 写批并物理 `text-chunks` / `tool-call-chunks` · `flush()` · open-turn 崩溃修复）；Host 经 `XRK_SESSIONS_DIR` 默认选用；drain idle / `stop` 时 flush/close。ZIP 导出 `toPackedJSONL` + `.jsonl.zst` sidecar；`fromPackedJSONL` 可导入；`searchSessionIds` 供 Face `session.search`。
