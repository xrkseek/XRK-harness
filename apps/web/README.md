# @xrkseek/harness-web

Face 验证台。**产品聊天 UI** 是捕获的 DSH Web：[`apps/web-static`](../web-static/)。

| 路径 | 作用 |
|------|------|
| `/`（本包 dist） | 说明页（仅当 serve 未找到 web-static 时才落到这里） |
| `/?console=1` | Face RPC / mux 验证台 |

日常：`serve` 默认托管 `apps/web-static`。对照源本机 `vendor/ui-src`（gitignore）；重捕：`pnpm web:ui:build && pnpm web:ui:capture`。

自研范围 = **Face Host 对接**（信封、审批 respond、Typert Remote、wire），不是重写 DSH UI。

## Dev

```bash
pnpm --filter @xrkseek/harness-web build
pnpm --filter @xrkseek/harness-web dev   # 代理到 :8787
```

## License

See [NOTICE](./NOTICE)。
