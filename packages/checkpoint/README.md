# @xrkseek/checkpoint

回合级**工作区文件快照**（turn rewind 的可恢复侧）。

A turn-scoped **workspace file snapshot** store: the recoverable half of turn
rewind.

## 为什么是影子 git

快照提交落在**独立**的 `--git-dir`（`<workspace>/.xrk/checkpoints/git`），
`--work-tree` 指向工作区。因此：

- 工作区本身不是 git 仓库也能快照；
- 永不读/写用户自己的 `.git`，不会改写操作者历史；
- 每条命令都带 `core.autocrlf=false`，Windows 上 restore 不会重写行尾。

`snapshot()` 用 `commit --allow-empty`，所以「这一回合没改文件」也仍是一个
**可恢复点**（它标记的是状态，而不是差异）。

## API

```ts
import { WorkspaceCheckpointStore, createProcessGitRunner } from "@xrkseek/checkpoint";

const store = new WorkspaceCheckpointStore({
  workspaceDir: "/path/to/ws",
  runGit: createProcessGitRunner(), // 注入：测试可传假 runner
});

// 回合开始前
const record = await store.snapshot({ sessionId: "s1", seq: 12, label: "pre-edit" });

// 改文件 · 跑工具 · …

// 预演：会说清哪些文件不在快照里（不会被误删）
const plan = await store.planRestore(record.id);
// → { id, fileCount, extra: ["scratch/new.txt"] }

// 回退：默认保留 extra；prune 才删除它们（ignored 文件永不触碰）
const result = await store.restore(record.id, { prune: false });
// → { id, fileCount, extra, restored, removed }
```

## 语义

| 方法                     | 行为                                                     |
| ------------------------ | -------------------------------------------------------- |
| `snapshot(input)`        | `add -A` → `commit --allow-empty` → 索引追加记录         |
| `list()`                 | 时间序（旧 → 新）记录                                    |
| `planRestore(id)`        | 预演：快照文件数 + 快照不知道的 untracked 文件           |
| `restore(id, { prune })` | `checkout --force <id> -- .`；`prune` 时追加 `clean -fd` |
| `prune(keep)`            | 只裁剪索引，保留最新 `keep` 条（影子提交仍在）           |

- `restore` 会**恢复**快照里存在、之后被删除的文件；
- 快照之后**新建**的文件默认保留（列在 `extra` 里）；
- `prune: true` 才删除它们，且 `clean` 不加 `-x`，**ignored 路径（如
  `node_modules`）永不删除**。

## 错误

`WorkspaceCheckpointError.code`：`bad-argument` · `git-unavailable` ·
`init-failed` · `snapshot-failed` · `restore-failed` · `unknown-checkpoint`。

`git` 不在 PATH 时 runner 解析为 `{ code: -1 }`，store 抛 `git-unavailable`
而不是崩溃。

## 测试

```bash
npx vitest run packages/checkpoint
```

`tests/store.test.ts` 用假 runner 断言 git argv 序列；`tests/shadow-git.integration.test.ts`
用真实 git 验证 restore 后内容回退、用户 `.git` 未被改写。
