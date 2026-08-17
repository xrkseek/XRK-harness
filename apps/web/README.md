# @xrkseek/harness-web

自研产品聊天壳 + Face 验证台。

| 路径 | 作用 |
|------|------|
| `/` | 自研聊天壳（侧栏会话 · 轨迹 · 输入；Face + `@xrkseek/web-runtime`） |
| `/?console=1` | Face RPC / mux 验证台 |

对照参考：本机 `vendor/ui-src`（gitignore）与仓内捕获 [apps/web-static](../web-static/)——只借交互/wire 逻辑，不搬 DSH 插件图。

## Dev

```bash
pnpm --filter @xrkseek/harness-web build
pnpm --filter @xrkseek/harness-web dev   # 代理到 :8787
```

`xrk-harness serve` 默认优先托管本包 `dist/`，其次才是 `apps/web-static`。

## License

See [NOTICE](./NOTICE)。
