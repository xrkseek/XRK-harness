# apps/web-static

产品聊天壳静态资源（捕获产物）。`xrk-harness serve` 默认优先托管本目录。

重新捕获（本机需 `vendor/ui-src`）：

```bash
pnpm web:ui:build
pnpm web:ui:capture
```

说明页 / Face 验证台仍在 [apps/web](../web/)。
