# apps/web-static

产品聊天壳：DeepSeek Harness Web 的**本地捕获产物**（MIT，见 [NOTICE](../web/NOTICE)）。与 DSH 的 `apps/web/dist/` 一样 **不入库**；本目录只跟踪这份说明。

`xrk-harness serve` 若找到本目录的 `index.html`（或 `vendor/web-static`）则托管产品壳。没有捕获时落到 Face console（`apps/web`）。不另画平行聊天 UI；不改 `@deepseek-ai/*` 插件 id。Host 注入 boot 时省略 Cordis 客户端面板与捕获壳 HMR。PWA 名 **XRK Harness** 由捕获脚本再贴。

本机对照源：`vendor/ui-src`（gitignore）。重捕：

```bash
pnpm web:ui:build
pnpm web:ui:capture
```

Face 验证台：[apps/web](../web/)（`?console=1`）。
