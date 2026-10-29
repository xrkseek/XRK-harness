# 策展记忆

> **读者**：集成者 · 贡献者

`memory` 把**跨会话都要用的短事实**写进两份文件：`MEMORY.md`（代理笔记）与 `USER.md`（用户是谁）。目录是 `{XRK_HOME}/memories`（默认 `~/.xrk/memories`）。文档库另走 `~/.xrk/mnemon`。

### 与站立文件的分界

| | 站立（可选 inject） | 策展（本页） |
|--|-------------------|-------------|
| `USER.md` | `~/.xrk/USER.md` · `{ws}/.xrk/USER.md` · `~/.agents/…` | `{XRK_HOME}/memories/USER.md` |
| `SOUL.md` / `IDENTITY.md` | 家目录 `~/.xrk/SOUL.md` = 产品种子（fingerprint）；用户人格优先写工作区 **`.xrk/SOUL.md` · `IDENTITY.md`** | — |
| 谁写 | 用户手写 | `memory` 工具 / 回合后笔记 / Phase1 |
| 进模型 | durable `agent-instructions` inject | **system** 冻结快照 |

产品 Identity 决策：**保持薄**——家目录种子 `AGENTS.md` + `SOUL.md`（均 fingerprint；全席）；用户自定人设写 **`.xrk/SOUL.md` / `IDENTITY.md`**；用户事实走策展 `memories/USER.md`（见 [skills-layers.md](./skills-layers.md) · [workspace-inject.md](./workspace-inject.md)）。

## 会话隔离（与站立计划分工）

| 能力 | 作用域 | 用途 |
|------|--------|------|
| `todo_write` → `todo/write` | **本会话** | 站立计划 / 任务清单；新会话为空 |
| 策展记忆 `MEMORY.md` / `USER.md` | **分区**（统一工具，目录分离） | `global`=`{XRK_HOME}/memories`；另有 `workspaces/{id}` · `sessions/{id}` · `agents/{memberId}`（干员）；工具可选 `scope` |

新会话会冻入磁盘上已有的策展记忆，**不会**带上上一会话的 `todo_write` 列表。进行中的任务清单、进度日志或「接着干」手记留在 `todo_write`（本会话内）；`MEMORY.md` 只放跨会话仍然成立的持久事实——把前者写进去会让下一会话误当成未完成队列。

系统提示在开启策展记忆时**始终**带策略段（即使文件为空），说明上述分工；有条目时再附上冻结正文。

## 冻结

组合创建时（一次会话一份组合）读这两份文件，渲染进系统提示。本会话之后的 `add` / `replace` / `remove` 只改磁盘，不改已经放进系统提示的那段文字。下一份组合重新从磁盘读取。

条目用 `§` 分隔（前后各一个换行）。`MEMORY.md` 上限 2200 字，`USER.md` 上限 1375 字。超限时单次 `add` 失败（错误可带 `prune_candidates`：最久未触碰条目，便于先删或压缩）；一次 `operations` 批次只按最终结果计字数，失败则整批不写。

文件后端在同目录维护触碰旁路 **`.usage.json`**（条目哈希 → 最近写入时间）；`list` 可附带 `stale_entries`（年龄证据）。Phase1 字数顶满时的软删按触碰年龄而非文件顺序，并追加 **`.trim-log.jsonl`**（尽力而为，失败不阻断巩固）。

## 工具

| 字段 | 含义 |
|------|------|
| `target` | `memory` 或 `user` |
| `action` | `add` · `replace` · `remove` · `list` |
| `content` | `add` / `replace` 的正文（`new_text` 同义） |
| `old_text` | `replace` / `remove` 用来定位的唯一子串 |
| `operations` | 上述写动作的原子列表（不含 `list`） |

`list` 返回目标文件当前磁盘条目（便于 replace/remove 前对齐原文），并可含 `stale_entries`。没有搜索；磁盘上无法按 `§` 往返的内容会被拒绝写入，并留下 `.bak` 副本。

关闭：**产品路径** Settings → Plugins → **策展记忆**（Face ns `curated-memory`：`enabled` · `phase2Llm`）。保存后下次 agent 重建卸下 `memory` 工具与系统提示冻结段。`phase2Llm` 开时会话结束在 Phase1 后再用当前会话模型做 Phase2 巩固（亦可用 `XRK_CURATED_MEMORY_PHASE2=1`）。非空 `XRK_CURATED_MEMORY` 为 CI 旁路（`0` 强制关，其它强制开）。组合选项 `curatedMemory: false` 仍可用。Host 按会话叠分区 store（global + workspace + session + 可选 agent）；`memory` 工具可传 `scope`。缺省写区：有干员 `memberId` 时为 `agent`，否则为 `session`。会话结束 Phase1/2 走**该会话的分层 store**（写入缺省区，不是单独再开一份 home-only `resolveMemoryProvider()`）。

## 分层完整性（诚实）

磁盘分区与 Host 接线已落地；「用户说记住 → 本会话立刻按新记忆行事」尚未完整。

| 层 | 状态 | 说明 |
|----|------|------|
| 磁盘区 `global` / `workspace` / `session` / `agent` | **能跑** | `{XRK_HOME}/memories` 与子目录；见 `scopes` |
| Host 按会话叠区 + 缺省 `scope` | **能跑** | 主会话默认 `session`；子代理有 `memberId` 时默认 `agent` |
| 工具 `scope` + 分区策略段 | **能跑** | 多区时用 `createScopedCuratedMemoryTools`；系统提示用 `SCOPED_CURATED_MEMORY_PROMPT_TEXT` |
| 组合创建时冻结快照 | **能跑** | 多区正文按区标题拼进 system；本会话内写盘**不**刷新冻结段 |
| 回合后启发式 / 会话结束 Phase1·2 | **能跑** | 写入分层 store 的缺省区；不刷新本会话冻结段 |
| 站立 `AGENTS` / `SOUL` / inject `USER` | **能跑** | 与策展分界见上表；站立不经 `memory` 工具 |
| Mnemon · memory-embed | **分开** | 文档库 / 向量检索，不是策展 `MEMORY.md` |
| 本会话即时生效的「干预记忆」 | **未做** | 写盘成功后，当前组合的系统提示仍是旧快照；下一会话才读到 |
| 按主题检索历史会话摘要 | **未做** | 无 rollout summary 索引；只有冻结全文 + `list` |
| 记忆引用 / 引用块 | **未做** | 模型不必标明用了哪条记忆 |

常见失败：`action` 为空且未传 `operations` → `Unknown action ''`（工具要求 `add|replace|remove|list` 或非空 `operations`）。用户口中的「干预记忆」指策展写入；没有单独同名产品能力。

## 提示词工程现状

| 载体 | 作用 | 评价 |
|------|------|------|
| 系统策略段 `CURATED_*_PROMPT_TEXT` | 分工、禁写 WIP、工具用法、分区、开关与冻结 | 开才注入；写盘不改本组合冻结段；关则下次空闲重建卸下 |
| `memory` 工具描述 | 何时写、`action` 或 `operations` 必填、勿塞 todo | 空 `action` 返回可执行错误 |
| 站立 `AGENTS.md` | 仅当 `memory` 在工具面上才调用 | 与策展开关分开：站立文件始终注入 |
| 向阳 skill `xrk-memory-polish` | 分区清理与迁移 | 缺省与 Host 一致：主会话 `session`，干员 `agent` |

## 拟吸收的改进（审阅 · 未改代码）

吸收业界 harness 策展流水线的长处，落点仍用本仓 `memory` / 分区 / 冻结语义（不引入第二套记忆产品名）。以下仅供审阅，**尚未改实现**。

1. **写后可见性** — 用户明确要求「记住 / 以后按这个做」时：要么在工具结果里写清「已落盘，本会话 system 仍是旧快照」；要么提供可选的本会话补充注入（不改冻结契约的前提下）。避免「写成功了却继续踩同一坑」。
2. **工具防呆** — `action` 与 `operations` 都缺时返回可执行示例（含 `action`+`content`+推荐 `scope`）；schema / 描述强调二选一必填。
3. **缺省区诚实** — 策略段与 polish skill 与 Host 对齐：主会话默认 `session`，干员默认 `agent`；跨项目偏好才写 `global`。
4. **巩固质量** — Phase2 从「抽 JSON 短句」升级为「按证据合并 / 删过时 / 区分偏好与单次任务结论」，并限制把过程性排障写进跨会话区。
5. **读侧克制** — 策略段补一句：冻结记忆不是当前行为的证明；会漂移或后果大的声明先核对源码 / 现配置。
6. **显式纠正优先** — 用户说「记住 / 改掉 / 忘掉」时优先 `memory` 工具；静默启发式不覆盖用户刚纠正的条目。
7. **不做什么（刻意）** — 不把 Mnemon / embedding 搜文档并进策展工具；不在子代理里再开一套独立产品记忆名；不把 `todo_write` 与策展合并。

## 回合结束写入

成功的回合结束之后，若用户原话里有可复用笔记（`remember:` / `memory:`，或稳定偏好如 “I prefer” / “我习惯”），写入 `MEMORY.md`。助手自己的发挥不写入。本回合已经调用过 `memory` 工具则不再写第二份。密钥会被替换成 `[REDACTED_SECRET]`。这次写入不刷新本会话已经冻进系统提示的快照。

## 会话结束 Phase1 / Phase2 巩固

会话离开活跃集时（组合 `dispose`、工作区 `workspace.archiveSession`、Host `stop`）走 **leased 流水线**（`runCuratedMemoryConsolidate`）：同会话 archive/stop/dispose **单飞**，避免 Phase1 双写。已在磁盘上覆盖的跳过，漏掉的追加进 `MEMORY.md`。字数顶满时会先软删**最久未触碰**条目（最多三次；有 `.usage.json` 时按触碰年龄，否则回落文件顺序）再试写入（不刷新本会话冻结快照）。结果写旁路 `.last-consolidate.json`，并进 Status / `/status` 的 `curatedMemory`（phase1Written · phase2 · provider）。

| 阶段 | 行为 |
|------|------|
| **Phase1**（默认） | 启发式抽取（`remember:` / 稳定偏好句）；无 LLM |
| **Phase2**（可选） | 注入会话 LLM 抽短事实（JSON 数组）；失败则空写，Phase1 仍会跑。Settings `curated-memory.phase2Llm` 或 `XRK_CURATED_MEMORY_PHASE2=1` |

## 可插拔 Provider（MemoryProvider）

对标 Hermes `MemoryProvider`：**默认仍是文件策展**；同时只选一个外部后端。

| Provider | 工厂 | 说明 |
|----------|------|------|
| `file`（默认） | `createFileMemoryProvider` / `createCuratedMemoryStore` | `{XRK_HOME}/memories` 的 `MEMORY.md` / `USER.md` |
| `http` | `createHttpMemoryProvider` | 集成方自建 REST：`GET /health` · `GET /v1/curated/{memory\|user}` · `POST /v1/curated/{memory\|user}/ops`；同步构造（冻结段为空，读写作 HTTP） |
| `sqlite` | `createSqliteMemoryProvider` | `{XRK_HOME}/memories/curated-memory.sqlite`（`node:sqlite`） |

选择：`resolveMemoryProvider({ kind })` 或 env `XRK_MEMORY_PROVIDER=file|http|sqlite`；HTTP 需 `XRK_MEMORY_HTTP_URL`（可选 `XRK_MEMORY_HTTP_TOKEN`）。组合选项仍可直接注入任意实现了 `CuratedMemoryStore` 的对象。provider 只负责策展记忆读写，不接 Mnemon 文档库 / memory-embed 的 `/search`。

---

# Curated memory

> **Audience**: Integrators · Contributors

`memory` stores **short facts that should survive every session** in two files: `MEMORY.md` (agent notes) and `USER.md` (who the user is). They live in `{XRK_HOME}/memories` (default `~/.xrk/memories`). This is not the Mnemon document library (`~/.xrk/mnemon`).

### Do not confuse with standing files

| | Standing (optional inject) | Curated (this page) |
|--|----------------------------|---------------------|
| `USER.md` | `~/.xrk/USER.md` · `{ws}/.xrk/USER.md` · `~/.agents/…` | `{XRK_HOME}/memories/USER.md` |
| `SOUL.md` / `IDENTITY.md` | Home `~/.xrk/SOUL.md` = product seed (fingerprint); prefer workspace **`.xrk/SOUL.md` · `IDENTITY.md`** for user persona | — |
| Who writes | User | `memory` tool / after-turn notes / Phase1 · Phase2 |
| Into the model | Durable `agent-instructions` inject | **System** frozen snapshot |

Identity product decision: **stay thin** — home seeds `AGENTS.md` + `SOUL.md` (both fingerprint; every audience); user persona in **`.xrk/SOUL.md` / `IDENTITY.md`**; factual “who the user is” stays in curated `memories/USER.md` ([skills-layers.md](./skills-layers.md) · [workspace-inject.md](./workspace-inject.md)).

## Session isolation (vs standing plan)

| Capability | Scope | Use for |
|------------|-------|---------|
| `todo_write` → `todo/write` | **This session** | Standing plan / checklist; empty in a new session |
| Curated `MEMORY.md` / `USER.md` | **Zoned** (one tool, separate dirs) | `global`=`{XRK_HOME}/memories`; also `workspaces/{id}` · `sessions/{id}` · `agents/{memberId}`; tool optional `scope` |

A new session freezes whatever curated files are already on disk; it does **not** carry the previous session's `todo_write` list. Do not put in-progress task lists, progress logs, or “continue from here” handoffs into `MEMORY.md` — the next session will otherwise treat them as an unfinished queue. Keep unfinished work in `todo_write`.

When curated memory is enabled, the system prompt **always** includes a policy section (even if the files are empty) that states this split; frozen file bodies are added only when entries exist.

## Freeze

When a composition is created (one composition per session), both files are read and rendered into the system prompt. Later `add` / `replace` / `remove` calls in that session update the files only. They do not change the block already placed in the system prompt. The next composition reads the files again.

Entries are separated by `§` with a newline on each side. `MEMORY.md` is capped at 2200 characters and `USER.md` at 1375. A single `add` fails when it would pass the cap (the error may include `prune_candidates` — longest-untouched entries to drop or compress first). An `operations` batch checks the character budget on the final result only; a failure writes nothing.

The file backend keeps a touch sidecar **`.usage.json`** (entry hash → last write time) beside the curated files; `list` may include `stale_entries`. Phase1 soft-trim ranks by touch age (not file order) and appends **`.trim-log.jsonl`** (best-effort; never fails the consolidate pass).

## Tool

| Field | Meaning |
|------|---------|
| `target` | `memory` or `user` |
| `action` | `add` · `replace` · `remove` · `list` |
| `content` | Body for `add` / `replace` (`new_text` is an alias) |
| `old_text` | Unique substring locating the entry for `replace` / `remove` |
| `operations` | Atomic list of write actions (no `list`) |

`list` returns live on-disk entries for the target (use before replace/remove) and may include `stale_entries`. There is no search. Content on disk that would not round-trip through the `§` delimiter is refused, and a `.bak` copy is kept.

Disable via **product path** Settings → Plugins → **Curated memory** (Face ns `curated-memory`: `enabled` · `phase2Llm`). After save, the next agent rebuild drops the `memory` tool and frozen system-prompt block. When `phase2Llm` is on, session end runs Phase2 consolidation after Phase1 with the current session model (also `XRK_CURATED_MEMORY_PHASE2=1`). Non-empty `XRK_CURATED_MEMORY` is the CI bypass (`0` force off, any other force on). Composition option `curatedMemory: false` still works. Host stacks zoned stores per session (global + workspace + session + optional agent); the `memory` tool accepts `scope`. Default write zone: `agent` when the child has a roster `memberId`, otherwise `session`. Session-end Phase1/2 uses **that session’s layered store** (writes the default zone — not a separate home-only `resolveMemoryProvider()`).

## Layer completeness (honest)

Disk zones and Host wiring ship; “user said remember → this session immediately obeys” does **not**.

| Layer | Status | Notes |
|-------|--------|-------|
| Disk zones `global` / `workspace` / `session` / `agent` | **Working** | Under `{XRK_HOME}/memories` (+ subdirs); see `scopes` |
| Host per-session stack + default `scope` | **Working** | Main session defaults to `session`; child with `memberId` defaults to `agent` |
| Tool `scope` + zoned policy text | **Working** | Multi-zone → `createScopedCuratedMemoryTools`; prompt → `SCOPED_CURATED_MEMORY_PROMPT_TEXT` |
| Freeze at composition create | **Working** | Zone bodies joined under headers; mid-session disk writes do **not** refresh the freeze |
| After-turn heuristics / session-end Phase1·2 | **Working** | Write the layered store’s default zone; freeze unchanged this session |
| Standing `AGENTS` / `SOUL` / inject `USER` | **Working** | Split as in the table above; standing is not the `memory` tool |
| Mnemon · memory-embed | **Separate** | Document library / embeddings — not curated `MEMORY.md` |
| Same-session “intervention memory” | **Not done** | Successful writes hit disk; the live system prompt stays the old freeze until the next composition |
| Retrieve prior-session summaries by topic | **Not done** | No rollout-summary index; freeze + `list` only |
| Memory citations | **Not done** | Model need not mark which entries it used |

Common failure: empty `action` and no `operations` → `Unknown action ''` (tool needs `add|replace|remove|list` or a non-empty `operations` batch). Colloquial “干预记忆” means curated writes — there is no separate product capability by that name.

## Prompt-engineering status

| Carrier | Role | Assessment |
|---------|------|------------|
| System policy `CURATED_*_PROMPT_TEXT` | Split, no WIP, tool usage, zones, switch vs freeze | Injected only while on; disk writes do not refresh this composition; off drops both on the next idle rebuild |
| `memory` tool description | When to write; `action` or `operations` required; no todos | Empty `action` returns an actionable error |
| Standing `AGENTS.md` | Call `memory` only when that tool is on the surface | Separate from the switch: standing files always inject |
| Xiangyang skill `xrk-memory-polish` | Zone cleanup / migration | Defaults match Host: main session `session`, 干员 `agent` |

## Proposed absorptions (review · not shipped)

Absorb strengths from industry harness curated-memory pipelines; keep this repo’s `memory` / zones / freeze semantics (no second product name). Review only — **not implemented yet**.

1. **Write visibility** — When the user explicitly asks to remember / obey a rule going forward: either state in the tool result that disk updated but this session’s system freeze is unchanged, or offer optional same-session supplemental inject without breaking the freeze contract. Avoid “write succeeded, same mistake continues.”
2. **Tool guardrails** — If both `action` and `operations` are missing, return a copy-pasteable example (`action`+`content`+recommended `scope`); schema/description require one of the two.
3. **Honest defaults** — Align policy text and polish skill with Host: main session → `session`, 干员 → `agent`; cross-project preferences → `global`.
4. **Consolidation quality** — Evolve Phase2 from “JSON short facts” toward evidence-backed merge / drop stale / separate preferences from one-off task conclusions; keep process debugging out of cross-session zones.
5. **Read-side restraint** — Policy line: frozen memory is not proof of current behavior; for consequential or drift-prone claims, check source/config first.
6. **Explicit correction wins** — On “remember / fix / forget”, prefer the `memory` tool; silent heuristics must not overwrite a correction the user just made.
7. **Deliberate non-goals** — Do not fold Mnemon / embedding search into the curated tool; do not invent a second memory product for subagents; do not merge `todo_write` with curated memory.

## Pluggable providers (`MemoryProvider`)

Hermes-style `MemoryProvider` seam: **file curated remains the default**; one backend at a time.

| Provider | Factory | Notes |
|----------|---------|-------|
| `file` (default) | `createFileMemoryProvider` / `createCuratedMemoryStore` | `{XRK_HOME}/memories` `MEMORY.md` / `USER.md` |
| `http` | `createHttpMemoryProvider` | Integrator-owned REST: `GET /health` · `GET /v1/curated/{memory\|user}` · `POST /v1/curated/{memory\|user}/ops`; sync construct (empty freeze; live I/O over HTTP) |
| `sqlite` | `createSqliteMemoryProvider` | `{XRK_HOME}/memories/curated-memory.sqlite` (`node:sqlite`) |

Select with `resolveMemoryProvider({ kind })` or env `XRK_MEMORY_PROVIDER=file|http|sqlite`; HTTP needs `XRK_MEMORY_HTTP_URL` (optional `XRK_MEMORY_HTTP_TOKEN`). Compositions may still inject any `CuratedMemoryStore` implementation. The provider handles curated memory read/write only; it does not reach Mnemon documents or memory-embed `/search`.

## Write after the turn

After a successful turn, reusable notes in the user's own words (`remember:` / `memory:`, or a stable preference such as "I prefer" / "我习惯") are appended to `MEMORY.md`. Assistant prose is not promoted. A turn that already called the `memory` tool is not written a second time. Secrets are replaced with `[REDACTED_SECRET]`. The write does not refresh the snapshot already frozen into this session's system prompt.

## Session-end Phase1 / Phase2 consolidate

When a session leaves the live set (composition `dispose`, `workspace.archiveSession`, Host `stop`), a **leased pipeline** (`runCuratedMemoryConsolidate`) runs: archive/stop/dispose for the same session are **single-flight** so Phase1 cannot double-write. Notes already covered on disk are skipped; leftovers are appended to `MEMORY.md`. If the character cap blocks a new note, the **longest-untouched** entries are soft-removed (up to three times; touch age from `.usage.json`, else file order) and the add is retried (the frozen session prompt is still unchanged). The result is written to `.last-consolidate.json` and surfaces on Status / `/status` as `curatedMemory` (phase1Written · phase2 · provider).

| Stage | Behavior |
|-------|----------|
| **Phase1** (default) | Heuristic extract (`remember:` / stable preference sentences); no LLM |
| **Phase2** (optional) | Injected session LLM extracts short facts (JSON array); on failure writes nothing — Phase1 still runs. Settings `curated-memory.phase2Llm` or `XRK_CURATED_MEMORY_PHASE2=1` |
