# apps/web-static

产品聊天壳：DeepSeek Harness Web 的捕获产物（MIT，见 [NOTICE](../web/NOTICE)），在本仓做产品向裁剪与品牌。

`xrk-harness serve` **默认优先**托管本目录。不另画平行聊天 UI；不改 `@deepseek-ai/*` 插件 id。Host 注入 boot 时省略 Cordis 客户端面板与捕获壳 HMR（内核不 `apply` Cordis；产品 serve 不提供 `/plugins/events`）。PWA `name` / 页标题为 **XRK Harness**；欢迎声明与设置里的搜索提供方文案由捕获脚本再贴（重捕不会冲掉）。

重新捕获（本机需 `vendor/ui-src`）：

```bash
pnpm web:ui:build
pnpm web:ui:capture
```

Face 验证台：[apps/web](../web/)（`?console=1`）。
