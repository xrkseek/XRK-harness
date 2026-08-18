# @xrkseek/harness-cli

CLI 入口：`xrk-harness`（`apps/cli`）。产品聊天 UI 是本机捕获（`apps/web-static`，不入库）；源码底稿 `apps/web` + `packages/client`。

## 命令

| 命令 | 作用 |
|------|------|
| `run` | 单 turn（默认 minimal + replay；设了 `XRK_LLM_PRESET` 则走 Registry） |
| `serve` | HTTP host + 产品壳 |
| `web` | `serve` 别名（对齐 `dsh web`） |
| `doctor` | Node ≥26 · workspace 目录 · 产品壳是否找得到 |
| `dump-config` | 打印 preset 组合配置 |
| `help` | 帮助 |

## 常用旗标

```text
--preset minimal|harness|server
--workspace <path>       # 用户工程根（会话 JSONL 默认落这里）
--prompt <text>          # run；也可位置参数
--host 127.0.0.1         # 拒绝 0.0.0.0
--port <n>               # 0 = OS 选口
--open                   # 系统浏览器打开产品 UI
--no-persist             # 内存会话（默认 {workspace}/.xrk/sessions）
--presentation tools|code
--patch '{"k":v}'
-V, --version
```

## 示例

```bash
pnpm build
node apps/cli/dist/bin.js serve --preset server --workspace .
node apps/cli/dist/bin.js web --port 8080 --open
node apps/cli/dist/bin.js run --preset minimal "ping"
node apps/cli/dist/bin.js doctor
```

`serve` 按 **CLI 包位置** 找本机 `apps/web-static`（无捕获则 `apps/console`），不把用户 `--workspace` 当成壳目录。捕获：在 bar 仓编出后设 `XRK_UI_SRC`，再 `pnpm web:ui:capture`。

## 环境变量

与 serve/HTTP 共用，见 [docs/http-api.md](../../docs/http-api.md)。

`XRK_LLM_PRESET` · `XRK_SESSIONS_DIR` · `XRK_WEB_DIST` · `XRK_API_KEY` · `XRK_HOST` · `XRK_PORT` · `XRK_WORKSPACE` · `XRK_PRESET`

调试：`XRK_DUMP_SESSION=1` 可在 run 路径向 stderr 打 session JSONL。

会话 JSONL 与 `host-settings.json` 在 `.xrk/` 下，已 gitignore，不要提交。

## 文档

[docs/profiles.md](../../docs/profiles.md) · [docs/host-face.md](../../docs/host-face.md) · [examples/hello-agent](../../examples/hello-agent)
