# 回合回退 · 工作区文件快照

> **读者**：集成者 · 贡献者 · 维护者

Turn rewind 的**可恢复侧**：把工作区文件按回合存成可回退的点。

## 问题

会话级回退（fork / rewind）只回退了**日志与上下文**。真正被改动的**文件**
留在原处：一次失败的工具调用、被覆盖的配置、被删掉的源文件，都还在。
日志回退了，工作区没有。

## 方案：影子 git

`packages/checkpoint` 的 `WorkspaceCheckpointStore` 把工作区提交进一个
**影子** git 仓库：

| 项            | 值                                                    |
| ------------- | ----------------------------------------------------- |
| 影子 git dir  | `<workspace>/.xrk/checkpoints/git`                    |
| `--work-tree` | 工作区本身                                            |
| 索引          | `<workspace>/.xrk/checkpoints/index.json`             |
| 提交身份      | 合成身份（`XRK Checkpoint <checkpoint@xrk.invalid>`） |

每条 git 命令都显式带上 `--git-dir=<影子>` **和** `--work-tree=<工作区>`，
因此：

- 工作区**不是** git 仓库也能快照；
- **永不**读/写操作者自己的 `.git`（不 stage、不提交、不动 HEAD）；
- 不依赖操作者的 git 身份 / 签名配置（`user.name` · `user.email` ·
  `commit.gpgsign=false` 都在命令行给定）——没配 `user.email` 的机器也能用；
- `core.autocrlf=false`，Windows 上 `restore` 不会重写行尾。

### 自指问题

影子仓库通常在**工作区内部**，所以 `git add -A` 会想把影子仓库自己的对象
文件也提交进去，而 `git clean -fd` 会想把它删掉。因此 store 会把
`core.excludesFile` 指向 `<影子>/exclude`，其中写入影子目录的工作区相对路径。
该文件在每次快照/回退前都会校验并按需重建（`clean` 前必须有，否则可能删掉
影子仓库自身）。

## API

```ts
import { WorkspaceCheckpointStore, createProcessGitRunner } from "@xrkseek/checkpoint";

const store = new WorkspaceCheckpointStore({
  workspaceDir: cwd,
  runGit: createProcessGitRunner(), // 注入：测试传假 runner
});

// 回合开始（工具调用之前）
const point = await store.snapshot({ sessionId, seq, label: "pre-turn" });

// … 模型改文件 …

// 预演：哪些文件不在快照里（不会被误删）
const plan = await store.planRestore(point.id);
// → { id, fileCount, extra: ["scratch/new.txt"] }

// 回退
const result = await store.restore(point.id, { prune: false });
// → { id, fileCount, extra, restored, removed }
```

## 语义

| 方法                                   | 行为                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `snapshot({ sessionId, seq, label? })` | `add -A` → `commit --allow-empty` → 追加索引记录，返回 `{ id, fileCount, … }` |
| `list()`                               | 时间序（旧 → 新）记录                                                         |
| `planRestore(id)`                      | 预演：快照文件数 + 快照不知道的 untracked 文件（`clean -nd`）                 |
| `restore(id, { prune })`               | `checkout --force <id> -- .`；`prune` 时再 `clean -fd`                        |
| `prune(keep)`                          | 只裁索引，保留最新 `keep` 条                                                  |

- 快照之后**被删除**的文件会被 `restore` 找回；
- 快照之后**新建**的文件默认**保留**，列在 `extra` 里；
- 只有 `prune: true` 才删除它们，且 `clean` **不加 `-x`**：ignored 路径
  （`node_modules`、构建产物）**永不删除**；
- `snapshot` 用 `--allow-empty`：没改文件的回合也是一个可恢复点。

## 错误码

`WorkspaceCheckpointError.code`：

| code                 | 何时                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `bad-argument`       | `sessionId` 空 / `seq` 非有限数 / `prune(keep)` 非法（且**不触碰 git**） |
| `git-unavailable`    | 无法启动 `git`（不在 PATH）                                              |
| `init-failed`        | 影子仓库 `init` 失败                                                     |
| `snapshot-failed`    | `add` / `commit` / `rev-parse` 失败                                      |
| `restore-failed`     | `ls-tree` / `checkout` / `clean` 失败                                    |
| `unknown-checkpoint` | 索引里没有该 id，或影子仓库已丢失                                        |

## 与既有能力的关系

| 能力 | 回退的是 | 产品入口 |
| ---- | -------- | -------- |
| `session.fork`（`fork-cut` / `resolveForkCut`） | **会话血缘**：按已完成 `turn/end` 截断日志，开子会话 | 消息旁 **Branch**；工具子代理 `inherit_context` |
| `SessionProjection` checkpoint | 投影缓存状态（list 冷列） | Host 内部 |
| **本文档**（`WorkspaceCheckpointStore`） | **工作区文件**（影子 git） | Face `session.checkpoint.*` · 斜杠 `/rollback` · 消息旁 **Restore** |

三者互不替代：

- **Branch / fork-cut** 只复制会话前缀，**不**改工作区文件；
- **Restore / `/rollback`** 只回退文件，**不**改会话日志（也不会 fork）；
- 只有日志回退而工作区不回退，重跑会建立在已被污染的文件上。

### Face 暴露

| 方法 / 入口 | 作用 |
| ----------- | ---- |
| `session.checkpoint.list` | 列出本 session（或 `allSessions`）快照 |
| `session.checkpoint.planRestore` | 预演（`id` 或 `atSeq`） |
| `session.checkpoint.restore` | 回退（可选 `prune`；`id` 或 `atSeq`） |
| `session.checkpoint.snapshot` | 手动打点（Host 在每轮 `continueTurn` 前也会自动打点） |
| `/rollback` | 列表；`/rollback <n\|id\|seq:N>` 回退；`plan …` 预演；`--prune` 删 extras |
| 消息 **Restore** | 对该轮 Face seq 发 `/rollback seq:N`（与 Branch 并列，语义不同） |

Host 默认在 drain 每轮 `continueTurn` 前调用 `snapshotSessionWorkspace`（`XRK_CHECKPOINTS=0` 关闭）。需本机 `git`。

## 注意

- 工作区里会出现 `.xrk/`（本产品惯例的 per-workspace 目录）。它会在操作者
  自己的 `git status` 里显示为 untracked；操作者需自行把 `.xrk/` 加进自己仓库的
  `.gitignore`。
- 影子仓库会随快照增长。`prune(keep)` 只裁索引；需要回收磁盘请对影子仓库
  执行 `git gc`（或直接删除 `<workspace>/.xrk/checkpoints`）。
- `restore` 是**破坏性**的：它会覆盖工作区里同名文件。调用方（Face / 工具）
  应先 `planRestore` 并把 `extra` 呈现给用户。

## 测试

```bash
npx vitest run packages/checkpoint
```

- `tests/store.test.ts`（假 runner）断言每条 git argv 序列、错误路径、索引
  持久化与裁剪；
- `tests/shadow-git.integration.test.ts`（真实 git）断言：restore 后内容回退、
  被删文件找回、`prune` 才删新建文件、影子目录不被 `clean` 删掉、操作者仓库的
  HEAD 与 index **未变**。

---

# Turn rewind · workspace file snapshots

> **Audience**: Integrators · Contributors · Maintainers

The **recoverable half** of turn rewind: worktree files captured as restore
points, per turn.

## The problem

Session-level rewind forks the **log and context** only. The files a turn
actually touched stay where they are — a failed tool call, an overwritten
config, a deleted source file. The transcript rewinds; the worktree does not.

## The approach: shadow git

`WorkspaceCheckpointStore` (in `packages/checkpoint`) commits the worktree into
a **shadow** git repository:

| Piece           | Value                                                 |
| --------------- | ----------------------------------------------------- |
| Shadow git dir  | `<workspace>/.xrk/checkpoints/git`                    |
| `--work-tree`   | the workspace itself                                  |
| Index           | `<workspace>/.xrk/checkpoints/index.json`             |
| Commit identity | synthetic (`XRK Checkpoint <checkpoint@xrk.invalid>`) |

Every command pins `--git-dir=<shadow>` **and** `--work-tree=<workspace>`, so:

- snapshotting works in a directory that is not a git repo at all;
- the operator's own `.git` is **never** read or written (nothing staged, no
  commits, HEAD untouched);
- shadow commits do not depend on the operator's git identity or signing config
  (`user.name` / `user.email` / `commit.gpgsign=false` are passed on the command
  line) — it works on a machine with no `user.email` set;
- `core.autocrlf=false`, so `restore` never rewrites line endings on Windows.

### The self-reference trap

The shadow repo usually lives _inside_ the worktree, so `git add -A` would stage
the repo's own object files and `git clean -fd` would delete them. The store
therefore points `core.excludesFile` at `<shadow>/exclude` containing the shadow
dir's worktree-relative path. That file is verified (and rebuilt) before every
snapshot / restore — `clean` must never run without it.

## API

See the TypeScript snippet above; `runGit` is the injected seam (tests pass a
scripted fake, production uses `createProcessGitRunner`).

## Semantics

| Method                                 | Behaviour                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `snapshot({ sessionId, seq, label? })` | `add -A` → `commit --allow-empty` → index record; returns `{ id, fileCount, … }` |
| `list()`                               | chronological (oldest → newest)                                                  |
| `planRestore(id)`                      | dry run: snapshot file count + files the snapshot never saw (`clean -nd`)        |
| `restore(id, { prune })`               | `checkout --force <id> -- .`; plus `clean -fd` when `prune`                      |
| `prune(keep)`                          | index-only trim, newest `keep` kept                                              |

- files **deleted** after the snapshot are brought back;
- files **added** after the snapshot survive by default and are listed in `extra`;
- only `prune: true` deletes them, and `clean` is run **without `-x`**: ignored
  paths (`node_modules`, build output) are never deleted;
- `snapshot` uses `--allow-empty`, so a turn that changed nothing is still a
  restore point.

## Error codes

`WorkspaceCheckpointError.code`: `bad-argument` (validated **before** git is
touched) · `git-unavailable` · `init-failed` · `snapshot-failed` ·
`restore-failed` · `unknown-checkpoint`.

## Relationship to existing pieces

| Capability | What it rewinds | Product entry |
| ---------- | --------------- | ------------- |
| `session.fork` (`fork-cut` / `resolveForkCut`) | **Session lineage**: cut the log at a completed `turn/end`, open a child | Message **Branch**; tool subagents with `inherit_context` |
| `SessionProjection` checkpoint | Projection cache (cold list column) | Host-internal |
| **This doc** (`WorkspaceCheckpointStore`) | **Worktree files** (shadow git) | Face `session.checkpoint.*` · slash `/rollback` · message **Restore** |

They do not substitute for each other:

- **Branch / fork-cut** copies a session prefix only — it does **not** change files;
- **Restore / `/rollback`** reverts files only — it does **not** rewrite the chat log (and does not fork);
- Rewind the log without rewinding files and a re-run builds on already-mutated input.

### Face surface

| Method / entry | Role |
| -------------- | ---- |
| `session.checkpoint.list` | List checkpoints for this session (or `allSessions`) |
| `session.checkpoint.planRestore` | Preview (`id` or `atSeq`) |
| `session.checkpoint.restore` | Restore (optional `prune`; `id` or `atSeq`) |
| `session.checkpoint.snapshot` | Manual snapshot (Host also snapshots before each `continueTurn`) |
| `/rollback` | List; `/rollback <n\|id\|seq:N>` restore; `plan …` preview; `--prune` drop extras |
| Message **Restore** | Issues `/rollback seq:N` for that turn’s Face seq (beside Branch; different meaning) |

Host calls `snapshotSessionWorkspace` before each drain `continueTurn` by default (`XRK_CHECKPOINTS=0` disables). Requires `git` on PATH.

## Caveats

- A `.xrk/` dir appears in the workspace (this product's per-workspace dot dir).
  It shows as untracked in the operator's own `git status`; operators add `.xrk/`
  to their own `.gitignore`.
- The shadow repo grows with snapshots. `prune(keep)` trims the index only; run
  `git gc` on the shadow repo (or delete `<workspace>/.xrk/checkpoints`) to
  reclaim disk.
- `restore` is destructive: it overwrites same-named files. Callers should
  `planRestore` first and surface `extra` to the user.

## Tests

```bash
npx vitest run packages/checkpoint
```

`tests/store.test.ts` (fake runner) asserts the exact git argv sequence, error
paths, index persistence and trimming. `tests/shadow-git.integration.test.ts`
(real git) asserts content is reverted, deleted files return, only `prune`
removes new files, the shadow dir survives `clean`, and the operator's HEAD and
index are unchanged.
