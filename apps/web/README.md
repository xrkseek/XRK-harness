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

完整产品聊天壳由 `serve` 托管的 web dist 提供（见 Host / CLI）。

## License

See [NOTICE](./NOTICE)。
