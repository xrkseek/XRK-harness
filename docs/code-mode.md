# Code Mode

> **读者**：贡献者（实验面）。

Use **Code Mode** when the model should run short JS snippets (`run_code`) instead of (or in addition to) emitting many atomic tool calls.

| Mode | When |
|------|------|
| Default tools | File/shell/todo — normal agent |
| `--presentation code` | Experimental: adds `run_code` worker tool |

```bash
node apps/cli/dist/bin.js run --preset harness --presentation code --prompt "ping"
```

## Safety

- Worker-thread isolation, timeout
- No network by default
- Still goes through the full tool waterfall if sub-tools are invoked later (M2: snippet only)

Default presets **do not** register `run_code`.
