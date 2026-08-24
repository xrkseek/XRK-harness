# Code Mode / Code Mode

> **读者 / Audience**：贡献者（实验面） / Contributors (experimental surface)

当模型应运行短 JS 片段（`run_code`），而不是（或额外于）发出大量原子工具调用时，使用 **Code Mode**。

Use **Code Mode** when the model should run short JS snippets (`run_code`) instead of (or in addition to) emitting many atomic tool calls.

| 模式 / Mode | 何时 / When |
|------|------|
| 默认工具 / Default tools | 文件 / shell / todo — 常规 agent / Normal agent |
| `--presentation code` | 实验：增加 `run_code` worker 工具 / Experimental: adds `run_code` |

```bash
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
```

## 安全 / Safety

- Worker-thread 隔离、超时 / Worker-thread isolation, timeout
- 默认无网络 / No network by default
- 若后续调用子工具，仍走完整工具瀑布（M2：当前仅为 snippet） / Still goes through the full tool waterfall if sub-tools are invoked later (M2: snippet only)

默认 presets **不**登记 `run_code`。 / Default presets **do not** register `run_code`.
