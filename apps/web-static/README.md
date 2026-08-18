# apps/web-static

产品壳捕获产物（gitignore）。源码底稿：[`apps/web`](../web/) + [`packages/client`](../../packages/client/)。

在完整 DSH 树（本机 bar 仓）编出 `apps/web/dist` 后：

```bash
XRK_UI_SRC=<dsh-checkout> pnpm web:ui:capture
```

无捕获时 `serve` 回退 [`apps/console`](../console/)。
