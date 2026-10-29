# 向日葵免费车道（sunflower-free）

> 本仓增量笔记。教科书真源：`extensions/xrk-sunflower-free/README.md` · `docs/configuration.md`「向日葵免费」。

- **Win Desktop**：`pnpm vendor:bun` → 随包 `vendor/bun.exe`；afterPack 缺 Bun 则失败。
- **macOS / Linux**：不随包 Bun；用户装到 `~/.bun/bin` 或 PATH（或 `XRK_SUNFLOWER_BUN`）。无 Bun → 跳过 OpenCode，Kilo 直连。
- Host `preserveIds` 必须含 `xrk-sunflower-free`（Desktop 延迟 reconcile 否则 dispose 清 key、zombie brand）。
