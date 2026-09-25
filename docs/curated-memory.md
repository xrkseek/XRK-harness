# 策展记忆

> **读者**：集成者 · 贡献者

`memory` 把**跨会话都要用的短事实**写进两份文件：`MEMORY.md`（代理笔记）与 `USER.md`（用户是谁）。目录是 `{XRK_HOME}/memories`（默认 `~/.xrk/memories`）。文档库另走 `~/.xrk/mnemon`。

### 勿与站立文件混淆

| | 站立（可选 inject） | 策展（本页） |
|--|-------------------|-------------|
| `USER.md` | `~/.xrk/USER.md` · `{ws}/.xrk/USER.md` · `~/.agents/…` | `{XRK_HOME}/memories/USER.md` |
| `SOUL.md` / `IDENTITY.md` | 用户手写人格 / 语气（**产品不自动种**） | — |
| 谁写 | 用户手写 | `memory` 工具 / 回合后笔记 / Phase1 |
| 进模型 | durable `agent-instructions` inject | **system** 冻结快照 |

产品 Identity 决策：**保持薄**——只种子 `~/.xrk/AGENTS.md`；SOUL/IDENTITY 可选；用户事实走策展 `memories/USER.md`（见 [skills-layers.md](./skills-layers.md) · [workspace-inject.md](./workspace-inject.md)）。

## 会话隔离（与站立计划分工）

| 能力 | 作用域 | 用途 |
|------|--------|------|
| `todo_write` → `todo/write` | **本会话** | 站立计划 / 任务清单；新会话为空 |
| 策展记忆 `MEMORY.md` / `USER.md` | **全局**（按 `XRK_HOME`） | 稳定偏好、长期约定、用户是谁 |

新会话会冻入磁盘上已有的策展记忆，**不会**带上上一会话的 `todo_write` 列表。不要把进行中的任务清单、进度日志或「接着干」手记写进 `MEMORY.md`——那会让下一会话误当成未完成队列。未完成工作用 `todo_write`。

系统提示在开启策展记忆时**始终**带策略段（即使文件为空），说明上述分工；有条目时再附上冻结正文。

## 冻结

组合创建时（一次会话一份组合）读这两份文件，渲染进系统提示。本会话之后的 `add` / `replace` / `remove` 只改磁盘，不改已经放进系统提示的那段文字。下一份组合重新从磁盘读取。

条目用 `§` 分隔（前后各一个换行）。`MEMORY.md` 上限 2200 字，`USER.md` 上限 1375 字。超限时单次 `add` 失败；一次 `operations` 批次只按最终结果计字数，失败则整批不写。

## 工具

| 字段 | 含义 |
|------|------|
| `target` | `memory` 或 `user` |
| `action` | `add` · `replace` · `remove` |
| `content` | `add` / `replace` 的正文（`new_text` 同义） |
| `old_text` | `replace` / `remove` 用来定位的唯一子串 |
| `operations` | 上述动作的原子列表 |

没有搜索、列表或读文件动作。磁盘上无法按 `§` 往返的内容会被拒绝写入，并留下 `.bak` 副本。

关闭：**产品路径** Settings → Plugins → **策展记忆**（Face ns `curated-memory`：`enabled`）。保存后下次 agent 重建卸下 `memory` 工具与系统提示冻结段。非空 `XRK_CURATED_MEMORY` 为 CI 旁路（`0` 强制关，其它强制开）。组合选项 `curatedMemory: false` 仍可用。

## 可插拔 Provider（MemoryProvider）

对标 Hermes `MemoryProvider`：**默认仍是文件策展**；可选外接一个 HTTP sidecar（同时只选一个外部后端）。

| Provider | 工厂 | 说明 |
|----------|------|------|
| `file`（默认） | `createFileMemoryProvider` / `createCuratedMemoryStore` | `{XRK_HOME}/memories` |
| `http` | `createHttpMemoryProvider` | 集成方自建 REST：`GET /health` · `GET /v1/curated/{memory\|user}` · `POST /v1/curated/{memory\|user}/ops` |

选择：`resolveMemoryProvider({ kind })` 或 env `XRK_MEMORY_PROVIDER=file|http`；HTTP 需 `XRK_MEMORY_HTTP_URL`（可选 `XRK_MEMORY_HTTP_TOKEN`）。组合选项仍可直接注入任意实现了 `CuratedMemoryStore` 的对象。provider 只负责策展记忆读写，不接 Mnemon 文档库 / memory-embed 的 `/search`。

## 回合结束写入

成功的回合结束之后，若用户原话里有可复用笔记（`remember:` / `memory:`，或稳定偏好如 “I prefer” / “我习惯”），写入 `MEMORY.md`。助手自己的发挥不写入。本回合已经调用过 `memory` 工具则不再写第二份。密钥会被替换成 `[REDACTED_SECRET]`。这次写入不刷新本会话已经冻进系统提示的快照。

## 会话结束 Phase1 巩固

会话离开活跃集时（组合 `dispose`、工作区 `workspace.archiveSession`、Host `stop`）再扫一遍该会话的人类用户原话：已在磁盘上覆盖的跳过，漏掉的追加进 `MEMORY.md`。字数顶满时会先软删最旧条目（最多三次）再试写入（不刷新本会话冻结快照）。该扫描只做磁盘覆盖去重后的追加写入，不做 LLM 抽取，也不做向量 / 文档 keyword 检索。

---

# Curated memory

> **Audience**: Integrators · Contributors

`memory` stores **short facts that should survive every session** in two files: `MEMORY.md` (agent notes) and `USER.md` (who the user is). They live in `{XRK_HOME}/memories` (default `~/.xrk/memories`). This is not the Mnemon document library (`~/.xrk/mnemon`).

### Do not confuse with standing files

| | Standing (optional inject) | Curated (this page) |
|--|----------------------------|---------------------|
| `USER.md` | `~/.xrk/USER.md` · `{ws}/.xrk/USER.md` · `~/.agents/…` | `{XRK_HOME}/memories/USER.md` |
| `SOUL.md` / `IDENTITY.md` | User-authored persona / tone (**product does not auto-seed**) | — |
| Who writes | User | `memory` tool / after-turn notes / Phase1 |
| Into the model | Durable `agent-instructions` inject | **System** frozen snapshot |

Identity product decision: **stay thin** — seed only `~/.xrk/AGENTS.md`; optional SOUL/IDENTITY; factual “who the user is” stays in curated `memories/USER.md` ([skills-layers.md](./skills-layers.md) · [workspace-inject.md](./workspace-inject.md)).

## Session isolation (vs standing plan)

| Capability | Scope | Use for |
|------------|-------|---------|
| `todo_write` → `todo/write` | **This session** | Standing plan / checklist; empty in a new session |
| Curated `MEMORY.md` / `USER.md` | **Global** (per `XRK_HOME`) | Stable preferences, lasting conventions, who the user is |

A new session freezes whatever curated files are already on disk; it does **not** carry the previous session's `todo_write` list. Do not put in-progress task lists, progress logs, or “continue from here” handoffs into `MEMORY.md` — the next session will otherwise treat them as an unfinished queue. Keep unfinished work in `todo_write`.

When curated memory is enabled, the system prompt **always** includes a policy section (even if the files are empty) that states this split; frozen file bodies are added only when entries exist.

## Freeze

When a composition is created (one composition per session), both files are read and rendered into the system prompt. Later `add` / `replace` / `remove` calls in that session update the files only. They do not change the block already placed in the system prompt. The next composition reads the files again.

Entries are separated by `§` with a newline on each side. `MEMORY.md` is capped at 2200 characters and `USER.md` at 1375. A single `add` fails when it would pass the cap. An `operations` batch checks the character budget on the final result only; a failure writes nothing.

## Tool

| Field | Meaning |
|------|---------|
| `target` | `memory` or `user` |
| `action` | `add` · `replace` · `remove` |
| `content` | Body for `add` / `replace` (`new_text` is an alias) |
| `old_text` | Unique substring locating the entry for `replace` / `remove` |
| `operations` | Atomic list of those actions |

There is no search, list, or read action. Content on disk that would not round-trip through the `§` delimiter is refused, and a `.bak` copy is kept.

Disable via **product path** Settings → Plugins → **Curated memory** (Face ns `curated-memory`: `enabled`). After save, the next agent rebuild drops the `memory` tool and frozen system-prompt block. Non-empty `XRK_CURATED_MEMORY` is the CI bypass (`0` force off, any other force on). Composition option `curatedMemory: false` still works.

## Pluggable providers (`MemoryProvider`)

Hermes-style `MemoryProvider` seam: **file curated remains the default**; optionally attach one HTTP sidecar (one external backend at a time).

| Provider | Factory | Notes |
|----------|---------|-------|
| `file` (default) | `createFileMemoryProvider` / `createCuratedMemoryStore` | `{XRK_HOME}/memories` |
| `http` | `createHttpMemoryProvider` | Integrator-owned REST: `GET /health` · `GET /v1/curated/{memory\|user}` · `POST /v1/curated/{memory\|user}/ops` |

Select with `resolveMemoryProvider({ kind })` or env `XRK_MEMORY_PROVIDER=file|http`; HTTP needs `XRK_MEMORY_HTTP_URL` (optional `XRK_MEMORY_HTTP_TOKEN`). Compositions may still inject any `CuratedMemoryStore` implementation. The provider handles curated memory read/write only; it does not reach Mnemon documents or memory-embed `/search`.

## Write after the turn

After a successful turn, reusable notes in the user's own words (`remember:` / `memory:`, or a stable preference such as "I prefer" / "我习惯") are appended to `MEMORY.md`. Assistant prose is not promoted. A turn that already called the `memory` tool is not written a second time. Secrets are replaced with `[REDACTED_SECRET]`. The write does not refresh the snapshot already frozen into this session's system prompt.

## Session-end Phase1 consolidate

When a session leaves the live set (composition `dispose`, `workspace.archiveSession`, Host `stop`), human user turns are scanned again: notes already covered on disk are skipped; leftovers are appended to `MEMORY.md`. If the character cap blocks a new note, the oldest entries are soft-removed (up to three times) and the add is retried (the frozen session prompt is still unchanged). The scan only appends after disk-coverage dedup; it performs no LLM extraction and no vector / document keyword search.
