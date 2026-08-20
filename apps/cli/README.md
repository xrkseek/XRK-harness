# @xrkseek/harness-cli

bin：`xrk-harness`。产品 UI：包内 `product-web/`（源码仓用 `apps/web/dist`）。

## 命令

| 命令 | 作用 |
|------|------|
| `run` | 单 turn（默认 minimal + replay） |
| `serve` / `web` | HTTP host + 产品壳 |
| `restart` | 释放监听端口后重新 serve |
| `doctor` | Node · workspace · 产品壳 |
| `dump-config` | 打印 preset 配置 |

常用 flags：`--verbose`（`/api` + MCP 细节）· `--force`（先杀占用端口）· `--quiet` · `XRK_LOG=debug`。

```bash
npx @xrkseek/harness-cli web
npx @xrkseek/harness-cli web --force --verbose
npx @xrkseek/harness-cli restart
# 源码：
pnpm build && pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

静态根：`XRK_WEB_DIST` → `product-web/` → `apps/web/dist`。配置见 [docs/configuration.md](../../docs/configuration.md)；发布见 [docs/publishing.md](../../docs/publishing.md)。
