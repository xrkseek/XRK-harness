# @xrkseek/harness-cli

bin：`xrk-harness`。产品 UI：包内 `product-web/`（源码仓用 `apps/web/dist`）。

## 命令

| 命令 | 作用 |
|------|------|
| `run` | 单 turn（默认 minimal + replay） |
| `serve` / `web` | HTTP host + 产品壳 |
| `doctor` | Node · workspace · 产品壳 |
| `dump-config` | 打印 preset 配置 |

```bash
npx @xrkseek/harness-cli web
# 源码：
pnpm build && pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

静态根：`XRK_WEB_DIST` → `product-web/` → `apps/web/dist`。配置见 [docs/configuration.md](../../docs/configuration.md)；发布见 [docs/publishing.md](../../docs/publishing.md)。
