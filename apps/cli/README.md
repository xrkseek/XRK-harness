# @xrkseek/harness-cli

CLI 入口：`xrk-harness`（`apps/cli`）。

## 命令

| 命令 | 作用 |
|------|------|
| `run` | 单 turn（默认 minimal + replay） |
| `serve` | 启动 HTTP host |
| `doctor` | 工作区 / 环境检查 |
| `dump-config` | 打印 preset 组合配置 |
| `help` | 帮助 |

## 常用旗标

```text
--preset minimal|harness|server
--workspace <path>
--prompt <text>          # run
--presentation tools|code  # harness：code 启用 run_code
--patch '{"k":v}'        # JSON 对象补丁（dump-config 等）
```

## 示例

```bash
pnpm check
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
node apps/cli/dist/bin.js serve --preset minimal --workspace .
node apps/cli/dist/bin.js dump-config --preset harness
```

## 环境变量

与 serve/HTTP 共用，见 [docs/http-api.md](../../docs/http-api.md)：

`XRK_API_KEY` · `XRK_HOST` · `XRK_PORT` · `XRK_WORKSPACE` · `XRK_PRESET` · `XRK_CORS_ORIGIN` · `XRK_RATE_LIMIT`

调试：`XRK_DUMP_SESSION=1` 可在 run 路径向 stderr 打 session JSONL（若命令支持）。

## 文档

[docs/profiles.md](../../docs/profiles.md) · [examples/hello-agent](../../examples/hello-agent)
