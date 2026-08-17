# apps/web-static

DSH 产品壳捕获产物（对照/后备）。`serve` 在缺少自研 `apps/web/dist` 时回退到本目录。

重新捕获（本机需 `vendor/ui-src`）：

```bash
pnpm web:ui:build
pnpm web:ui:capture
```

日常产品 UI 以 [apps/web](../web/) 自研壳为准。
