# @xrkseek/harness-web

本包提供说明页与 Face 验证台：

| 路径 | 作用 |
|------|------|
| `/` | 说明页 + Logo |
| `/?console=1` | Face RPC / mux 验证台 |

## Dev

```bash
pnpm --filter @xrkseek/harness-web build
pnpm --filter @xrkseek/harness-web dev   # 代理到 :8787
```

完整产品聊天壳：仓库内 [apps/web-static](../web-static/)（`serve` 默认托管）。

## License

See [NOTICE](./NOTICE)。
