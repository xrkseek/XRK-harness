# Code Mode

> **读者**：贡献者（实验面）

当模型应运行短 JS 片段（`run_code`），而不是（或额外于）发出大量原子工具调用时，使用 **Code Mode**。

| 模式 | 何时 |
|------|------|
| 默认工具 | 文件 / shell / todo — 常规 agent |
| `--presentation code` | 实验：增加 `run_code` worker 工具 |

```bash
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
```

## 安全

- Worker-thread 隔离、超时
- 默认无网络
- 若后续调用子工具，仍走完整工具瀑布（M2：当前仅为 snippet）

默认 presets **不**登记 `run_code`。

---

# Code Mode

> **Audience**: Contributors (experimental surface)

Use **Code Mode** when the model should run short JS snippets (`run_code`) instead of (or in addition to) emitting many atomic tool calls.

| Mode | When |
|------|------|
| Default tools | File / shell / todo — normal agent |
| `--presentation code` | Experimental: adds the `run_code` worker tool |

```bash
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
```

## Safety

- Worker-thread isolation and timeout
- No network by default
- If sub-tools are invoked later, they still go through the full tool waterfall (M2: snippet only today)

Default presets **do not** register `run_code`.
