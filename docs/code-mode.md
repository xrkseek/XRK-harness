# Code Mode

> **读者**：贡献者（实验面）

当模型应运行短 JS 程序（`run_code`），用程序编排多次工具调用，而不是（或额外于）发出大量原子工具调用时，使用 **Code Mode**。

| 模式 | 何时 |
|------|------|
| 默认工具 | 文件 / shell / todo — 常规 agent |
| `--presentation code` | 实验：增加 `run_code`；程序内 `await tools.<name>(args)` 重入同一工具瀑布 |

```bash
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
```

## 程序内调工具

- 源码是 **async 函数体**（可用顶层 `await` / `return`）
- 绑定 `tools` / `console`；调用形态：`const out = await tools.read_file({ path: "…" })`
- 嵌套调用经 `createRegistryCodeToolBridge` 走 live registry + composition `pipeline`（policy / settle 与 agent 同路）
- **不嵌套** `run_code`（防递归）
- 有 bridge 时走 **进程内 AsyncFunction**（Worker / SSH snippet runner 不用于该次执行；工具 IO 仍走 composition 的 fs/shell，含 SSH 远端世界）

```js
const text = await tools.read_file({ path: "README.md" });
console.log(text.slice(0, 200));
return "ok";
```

## 安全

- 无 bridge：Worker-thread 隔离（或 SSH 远端 Node snippet）
- 有 bridge：程序与 Host 同进程；隔离边界在各工具自身（sandbox / policy）
- 按次超时：默认 **120s**，上限 **600s**；模型可传 `timeoutMs`（正数，超出上限被夹紧；`0` 不是禁用）
- 输出硬顶：合并 stdout/stderr/返回值 UTF-8 默认 **64MiB**（`maxOutputBytes`）
- Worker 堆硬顶（无 bridge）：`resourceLimits.maxOldGenerationSizeMb` 默认 **512**
- 默认无网络（Worker 路径）
- 生成的 `tools:sdk`（及同类工具文档段）须 `interpolate: false`：schema / 说明中的字面 `{{…}}` 不被提示词变量替换

默认 presets **不**登记 `run_code`（用 `--presentation code` 或显式 `codeRuntime`）。

---

# Code Mode

> **Audience**: Contributors (experimental surface)

Use **Code Mode** when the model should run a short JS program (`run_code`) that orchestrates tool calls instead of (or in addition to) emitting many atomic tool calls.

| Mode | When |
|------|------|
| Default tools | File / shell / todo — normal agent |
| `--presentation code` | Experimental: adds `run_code`; in-program `await tools.<name>(args)` re-enters the same tool waterfall |

```bash
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
```

## Tools-in-code

- Source is an **async function body** (top-level `await` / `return` work)
- Bound names: `tools` / `console`; call shape: `const out = await tools.read_file({ path: "…" })`
- Nested calls go through `createRegistryCodeToolBridge` over the live registry + composition `pipeline` (same policy / settle as the agent)
- Nested `run_code` is **forbidden** (no recursion)
- With a bridge, execution uses an **in-process AsyncFunction** (Worker / SSH snippet runners are unused for that call; tool I/O still uses the composition's fs/shell, including an SSH remote world)

```js
const text = await tools.read_file({ path: "README.md" });
console.log(text.slice(0, 200));
return "ok";
```

## Safety

- Without a bridge: Worker-thread isolation (or SSH remote Node snippet)
- With a bridge: program shares the Host process; isolation sits in each tool (sandbox / policy)
- Per-call timeout: default **120s**, max **600s**; the model may pass `timeoutMs` (positive; clamped to the max; `0` does not disable)
- Output hard cap: combined stdout/stderr/return value UTF-8 default **64MiB** (`maxOutputBytes`)
- Worker heap hard cap (no bridge): `resourceLimits.maxOldGenerationSizeMb` default **512**
- No network by default (Worker path)
- Generated `tools:sdk` (and similar tool-doc sections) must set `interpolate: false` so literal `{{…}}` in schemas/descriptions is not consumed as prompt variables

Default presets **do not** register `run_code` (needs `--presentation code` or an explicit `codeRuntime`).
