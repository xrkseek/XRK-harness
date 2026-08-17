# @xrkseek/harness-web

本包不是完整产品聊天壳。完整壳由本地 UI 源构建捕获到 `vendor/web-static`（gitignore），再由 `serve` 托管。

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

产品壳：`pnpm web:ui:build` → `pnpm web:ui:capture` → `serve`。

## License

See [NOTICE](./NOTICE)。
