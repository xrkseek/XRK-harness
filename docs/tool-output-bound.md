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

一条策略，不是两套落盘。落盘与 notice 策略在 **`@xrkseek/spill`** 分离：`SpillStore` / `LocalSpillStore` 写盘；`applySpillPolicy` / `formatSpillNotice` / `parseSpillLocator` 管何时溢出与模型可见文案。agent-loop `boundToolResultContent` 只做 MessageContent 适配。概况 Status 的 spill 行经 `host.openPath` 打开 locator。

| | pipeline `boundToolOutput` | agent-loop `boundToolResultContent` |
|--|------------------------------|--------------------------------------|
| 字节上限 | 默认 **64_000**；harness 用 Face `agent-loop.toolResultMaxInlineBytes`（`0` 关闭 bound） | 同一个数（省略 → 64_000；`0` 关闭） |
| 行数 | 默认 2000，只在这一层 | 不另计行 |
| 全文 | `persist` 写到 `~/.xrk/spill/tool-outputs/` | 优先用 pipeline `outputPaths`；否则解析正文里的 `full content saved to`。命中则**不再写第二份**，只压内联预览并保留原路径 |
| 未挂 persist | 只截断、不落盘 | 仍超上限时，**同一目录**写一份（`spill/tool-outputs/<session>_<call>.txt`） |

`@session` 引用全文经 **`@xrkseek/spill` `LocalSpillStore`**（`source.kind: "session-reference"`）落到 `~/.xrk/spill/<session>/`，与工具结果同店不同 kind；不是第二套裸写盘。

## 落盘路径与何时有文件

产品 home 默认 `~/.xrk`（可用 `XRK_HOME` 覆盖）。Spill **只在首次超限写盘时建目录**：

| 路径 | 谁写 | 何时出现 |
|------|------|----------|
| `{XRK_HOME}/spill/tool-outputs/` | pipeline persist · agent-loop · **子代理长答案** | 某次正文超过对应内联上限才 `mkdir`；空仓或从未超限时**目录可以不存在**——不等于配置坏了 |
| `{XRK_HOME}/spill/<sessionId>/` | `@session` 引用全文 | 引用落盘时 |

文件名形如 `<parentSessionId>_subagent-<childSessionId>.txt`（子代理答案）或 `<sessionId>_<callId>.txt`（普通工具）。概况 **Status / 上下文** 列出 spill 条目并可「打开 spill」；模型可见正文里也会带路径 + `read_file` 提示。

### 子代理答案（同一目录，更低上限）

前台 / 后台子代理回给父会话的最终答案经 `boundChildAnswer`：UTF-8 **超过 12_000 字节**才 spill（`SUBAGENT_ANSWER_INLINE_BYTES`），仍写入 **`spill/tool-outputs/`**（与 64KiB 工具结果同店），内联只留 head/tail + 读盘提示。刻意低于 64KiB，避免「子答案 spill 后再被工具结果 bound 二次落盘」。

### 不是 spill 的情况（别去翻 tool-outputs）

| 现象 | 去哪找 | 说明 |
|------|--------|------|
| 子代理正常跑完，答案不长 | 父会话里该次 `subagent` / `wait_agent` 工具结果正文，或后台 steer 完成通知全文 | **≤12KB 不写盘**；`spill/tool-outputs` 空或不存在是常态。后台通知旧实现曾硬截 **2000 字**（已改为与前台相同的 `boundChildAnswer`） |
| 子代理答到一半停住，但 `turn/end.reason.kind === "completed"` | 该子会话事件日志 / `sessions.db` | 模型层截断，**不会**因「答不完整」自动写 spill |
| 用户 Stop 父会话级联停子 | 无 completion notice（已 suppress） | 手动停父不回传；不是 spill |
| 子代理异常 `aborted` / `error` idle | 父会话 inbox 的 steer 通知（文案 `ended abnormally`） | 回传截断预览；仅当正文曾超 12KB 且已 spill 时才有 `tool-outputs` 文件 |
| 只有 `~/.xrk/spill/` 没有 `tool-outputs/` | — | 尚未发生过工具 / 子答案超限写盘 |

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

One policy, not two stores. Persistence and notice policy live in **`@xrkseek/spill`**: `SpillStore` / `LocalSpillStore` write bytes; `applySpillPolicy` / `formatSpillNotice` / `parseSpillLocator` decide when to spill and what the model sees. agent-loop `boundToolResultContent` is the MessageContent adapter. Status overview opens spill locators via `host.openPath`.

| | pipeline `boundToolOutput` | agent-loop `boundToolResultContent` |
|--|------------------------------|--------------------------------------|
| Byte ceiling | Default **64_000**; harness uses Face `agent-loop.toolResultMaxInlineBytes` (`0` disables the bound) | The same number (omit → 64_000; `0` disables) |
| Lines | Default 2000, this layer only | No extra line cap |
| Full body | `persist` writes `~/.xrk/spill/tool-outputs/` | Prefers pipeline `outputPaths`; else parses `full content saved to` in the text. On hit **no second file** — shrink the inline preview and keep that path |
| No persist mounted | Truncate only | If still over the ceiling, write **once in that same directory** (`spill/tool-outputs/<session>_<call>.txt`) |

`@session` reference transcripts persist through **`@xrkseek/spill` `LocalSpillStore`** (`source.kind: "session-reference"`) under `~/.xrk/spill/<session>/` — same store, different kind; not a second bare write path.

## Paths and when files appear

Product home defaults to `~/.xrk` (override with `XRK_HOME`). Spill directories are created **only on the first over-limit write**:

| Path | Writer | When it appears |
|------|--------|-----------------|
| `{XRK_HOME}/spill/tool-outputs/` | pipeline persist · agent-loop · **long subagent answers** | First body over its inline ceiling triggers `mkdir`; a missing folder on a fresh home means **nothing has spilled yet**, not a misconfig |
| `{XRK_HOME}/spill/<sessionId>/` | `@session` reference bodies | When a reference is persisted |

Filenames look like `<parentSessionId>_subagent-<childSessionId>.txt` (child answers) or `<sessionId>_<callId>.txt` (ordinary tools). Overview **Status / Context** lists spill rows and can open them; the model-visible body also carries the path plus a `read_file` hint.

### Subagent answers (same directory, lower ceiling)

Foreground / background child answers returned to the parent go through `boundChildAnswer`: spill only when UTF-8 length exceeds **12_000 bytes** (`SUBAGENT_ANSWER_INLINE_BYTES`), still under **`spill/tool-outputs/`** (same store as the 64KiB tool bound), with head/tail + a read-disk lead-in inline. The lower ceiling avoids a second spill pass through the 64KiB tool-result bound.

### Not spill (do not dig in tool-outputs for these)

| Symptom | Where to look | Notes |
|---------|---------------|-------|
| Child finishes normally with a short answer | That `subagent` / `wait_agent` tool-result body, or the background steer completion notice | **≤12KB stays inline** — empty / missing `tool-outputs` is normal. Background notices used to hard-clip at **2000 chars** (now the same `boundChildAnswer` path as foreground) |
| Child stops mid-sentence but `turn/end.reason.kind === "completed"` | That child session's event log / `sessions.db` | Model-layer cut — **no** automatic spill for "incomplete answer" |
| User Stop on parent cascades to children | No completion notice (suppressed) | Manual parent Stop does not steer back; not spill |
| Child abnormal `aborted` / `error` idle | Parent inbox steer (`ended abnormally`) | Truncated preview is steered; a `tool-outputs` file exists only if the body already spilled (>12KB) |
| `~/.xrk/spill/` exists but no `tool-outputs/` | — | No tool / child answer has exceeded its inline ceiling yet |

## Boundaries

- Does not authorize execution (still guards)
- Does not replace leaf capture limits (e.g. shell stdout self-limits)
- Session log stores **post-bound** text (model-visible ≡ log)
- Full body stays under product home (default `~/.xrk/spill/tool-outputs/…`) and does not enter session events or the workspace tree
- One oversized tool result has one full-body path
- Disk: one file at most **8 MiB** (cut, with a marker at the end); the whole `~/.xrk/spill` tree at most **256 MiB**, and files older than **7 days** are removed on the next spill write. Age first, then oldest files until the total fits. Symlinks are not followed
- Host `hostReadableRoots` whitelists `{XRK_HOME}/spill` and the attachments subtree; `read_file` realpath-checks absolute paths so a spill symlink cannot expose other home files
