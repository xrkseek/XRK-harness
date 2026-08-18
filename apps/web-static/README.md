# apps/web-static

产品聊天壳：以 DeepSeek Harness Web 为 MIT 二次创作底稿的**本地捕获产物**（见 [NOTICE](../web/NOTICE)）。编译/捕获结果 **不入库**；本目录只跟踪这份说明。不是 GitHub Fork，不向 deepseek-ai 提 PR。

`xrk-harness serve` 若找到本目录的 `index.html`（或 `vendor/web-static`）则托管产品壳。没有捕获时落到 Face console（`apps/web`）。不另画平行聊天 UI；不改 `@deepseek-ai/*` 插件 id。Host 注入 boot 时省略 Cordis 客户端面板与捕获壳 HMR。PWA 名 **XRK Harness** 由捕获脚本再贴。

本机对照源：`vendor/ui-src`（gitignore）。重捕：

```bash
pnpm web:ui:build
pnpm web:ui:capture
```

Face 验证台：[apps/web](../web/)（`?console=1`）。
