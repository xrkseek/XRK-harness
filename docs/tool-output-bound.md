# 工具输出封顶

> **读者**：贡献者

通用「给模型看的」输出封顶。  
**叶工具可返回完整域输出**；pipeline 在 `finalize` 之后统一 bound，再 freeze `tool/result`。

## 默认

| 限制 | 默认 |
|------|------|
| `maxLines` | 2000 |
| `maxBytes` | 64_000（与 agent-loop spill 同一字节上限） |

超出则 head/tail 预览 + marker；若提供 `persist(full) → path`，marker 含路径，完整内容进托管存储。**全文只写这一次。**

## API

```ts
boundToolOutput(text, { maxLines, maxBytes, persist? })
createToolPipeline({ outputBound: false | { … } }) // default on (no persist = truncate only)
createMemoryToolOutputPersist() // tests / no disk
createWorkspaceToolOutputPersist() // host disk: `~/.xrk/spill/tool-outputs/`
```

`minimal` / `harness` preset 默认挂 workspace persist。  
`RunToolOutcome` 可带 `truncated` / `outputPaths`。

## 与 agent-loop spill 的分工

一条策略，不是两套落盘：

| | pipeline `boundToolOutput` | agent-loop `boundToolResultContent` |
|--|------------------------------|--------------------------------------|
| 字节上限 | 默认 **64_000**；harness 用 Face `agent-loop.toolResultMaxInlineBytes`（`0` 关闭 bound） | 同一个数（省略 → 64_000；`0` 关闭） |
| 行数 | 默认 2000，只在这一层 | 不另计行 |
| 全文 | `persist` 写到 `~/.xrk/spill/tool-outputs/` | 优先用 pipeline `outputPaths`；否则解析正文里的 `full content saved to`。命中则**不再写第二份**，只压内联预览并保留原路径 |
| 未挂 persist | 只截断、不落盘 | 仍超上限时，**同一目录**写一份（`spill/tool-outputs/<session>_<call>.txt`） |

`@session` 引用全文在 `~/.xrk/spill/<session>/`，不是工具结果，不与上表混用。

## 边界

- 不做执行授权（仍是 guards）
- 不替代叶内 capture 限额（如 shell stdout 自限）
- 会话日志存 **bound 后** 文本（模型可见 ≡ 日志）
- 完整正文在产品 home（默认 `~/.xrk/spill/tool-outputs/…`），不进 session 事件、不写入工作区
- 一次超限工具结果只对应一个全文路径
- 磁盘：单文件最多 **8 MiB**（超出则截断并在文件末尾标明）；整个 `~/.xrk/spill` 最多 **256 MiB**，且超过 **7 天** 的文件在下次落盘时删除。先按年龄删，仍超总量则从最旧的文件继续删。不跟随符号链接
- Host `hostReadableRoots` 白名单为 `{XRK_HOME}/spill` 与 attachments 子树；`read_file` 对绝对路径做 realpath 校验，禁止经 spill 符号链接读出 home 内其它文件

---

# Tool Output Bound

> **Audience**: Contributors

Generic cap on model-visible output.  
**Leaf tools may return full domain output**; the pipeline applies a uniform bound after `finalize`, then freezes `tool/result`.

## Defaults

| Limit | Default |
|------|------|
| `maxLines` | 2000 |
| `maxBytes` | 64_000 (same byte ceiling as agent-loop spill) |

Over limit: head/tail preview + marker; if `persist(full) → path` is provided, the marker includes the path and the full body goes to managed storage. **The full body is written once.**

## API

```ts
boundToolOutput(text, { maxLines, maxBytes, persist? })
createToolPipeline({ outputBound: false | { … } }) // default on (no persist = truncate only)
createMemoryToolOutputPersist() // tests / no disk
createWorkspaceToolOutputPersist() // host disk: `~/.xrk/spill/tool-outputs/`
```

`minimal` / `harness` presets mount workspace persist by default.  
`RunToolOutcome` may carry `truncated` / `outputPaths`.

## Split with agent-loop spill

One policy, not two stores:

| | pipeline `boundToolOutput` | agent-loop `boundToolResultContent` |
|--|------------------------------|--------------------------------------|
| Byte ceiling | Default **64_000**; harness uses Face `agent-loop.toolResultMaxInlineBytes` (`0` disables the bound) | The same number (omit → 64_000; `0` disables) |
| Lines | Default 2000, this layer only | No extra line cap |
| Full body | `persist` writes `~/.xrk/spill/tool-outputs/` | Prefers pipeline `outputPaths`; else parses `full content saved to` in the text. On hit **no second file** — shrink the inline preview and keep that path |
| No persist mounted | Truncate only | If still over the ceiling, write **once in that same directory** (`spill/tool-outputs/<session>_<call>.txt`) |

`@session` reference transcripts live under `~/.xrk/spill/<session>/`. They are not tool results and are not part of this table.

## Boundaries

- Does not authorize execution (still guards)
- Does not replace leaf capture limits (e.g. shell stdout self-limits)
- Session log stores **post-bound** text (model-visible ≡ log)
- Full body stays under product home (default `~/.xrk/spill/tool-outputs/…`) and does not enter session events or the workspace tree
- One oversized tool result has one full-body path
- Disk: one file at most **8 MiB** (cut, with a marker at the end); the whole `~/.xrk/spill` tree at most **256 MiB**, and files older than **7 days** are removed on the next spill write. Age first, then oldest files until the total fits. Symlinks are not followed
- Host `hostReadableRoots` whitelists `{XRK_HOME}/spill` and the attachments subtree; `read_file` realpath-checks absolute paths so a spill symlink cannot expose other home files
