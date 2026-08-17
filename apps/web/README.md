# @xrkseek/harness-web

**不是**产品聊天壳。产品 UI = XRKbar 的 DeepSeek Harness fork，经
`pnpm web:dsh:capture` 落到 `vendor/dsh-web-static`，由 `serve` 托管。

本包只保留：

| 路径 | 作用 |
|------|------|
| `/` | 说明页 + Logo |
| `/?console=1` | Face RPC / mux 验证台 |

## Dev

```bash
pnpm --filter @xrkseek/harness-web build
pnpm --filter @xrkseek/harness-web dev   # 代理到 :8787
```

产品壳：`pnpm web:dsh:build` → `pnpm web:dsh:capture` → `serve`。

## License

See [NOTICE](./NOTICE)。
