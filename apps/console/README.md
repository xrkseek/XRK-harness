# @xrkseek/harness-console

Face 验证台（`?console=1`）。产品聊天壳源码在 [`apps/web`](../web/) + [`packages/client`](../../packages/client/)；捕获面 [`apps/web-static`](../web-static/)（gitignore）。

| 路径 | 作用 |
|------|------|
| `/` | 说明页（无捕获时 serve 回退） |
| `/?console=1` | Face RPC / mux 验证台 |

```bash
pnpm --filter @xrkseek/harness-console build
pnpm --filter @xrkseek/harness-console dev
```
