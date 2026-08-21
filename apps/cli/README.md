# @xrkseek/harness-cli

bin：`xrk-harness`。产品 UI：包内 `product-web/`（源码仓用 `apps/web/dist`）。

## 命令

| 命令 | 作用 |
|------|------|
| `run` | 单 turn（默认 minimal + replay） |
| `serve` / `web` | HTTP host + 产品壳（默认 **XRK Harness** 工具面） |
| `restart` | 停**本机先前的 XRK Host**（`~/.xrk/run/host-<port>.pid.json`）再起；不杀陌生进程 |
| `plugin` | 安装 / 卸载 / 列出用户插件（`~/.xrk/plugins`） |
| `doctor` | Node · workspace · 产品壳 |
| `dump-config` | 打印 preset 配置 |

| Flag | 作用 |
|------|------|
| `--force` | 只停**已识别为 XRK Host** 的监听进程；端口被其它程序占用则报错退出 |
| `--verbose` | `/api` + MCP 细节 |
| `--quiet` | 仅 warn/error |

OpenClaw/DSH 的 `gateway --force` 仍是按端口杀监听；其更成熟路径是服务管理器 + `--safe` drain。本 CLI 是前台进程，用 **pid 锁 + 指纹校验** 代替「杀端口上任意进程」。

Preset 分层：[docs/profiles.md](../../docs/profiles.md)。写插件：[docs/plugin-development.md](../../docs/plugin-development.md)。

```bash
npx @xrkseek/harness-cli web
npx @xrkseek/harness-cli restart
npx @xrkseek/harness-cli plugin add ./extensions/example-tools
# 源码：
pnpm build && pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

静态根：`XRK_WEB_DIST` → `product-web/` → `apps/web/dist`。配置见 [docs/configuration.md](../../docs/configuration.md)。
