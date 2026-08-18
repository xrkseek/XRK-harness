# apps/web-static

产品聊天壳：DeepSeek Harness Web 的捕获产物（MIT，见 [NOTICE](../web/NOTICE)）。

`xrk-harness serve` **默认优先**托管本目录。本仓只做 Face 对接；UI 观感以 DSH 为准。

重新捕获（本机需 `vendor/ui-src`）：

```bash
pnpm web:ui:build
pnpm web:ui:capture
```

Face 验证台：[apps/web](../web/)（`?console=1`）。
