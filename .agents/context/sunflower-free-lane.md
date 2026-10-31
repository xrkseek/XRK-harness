# 向日葵免费车道（sunflower-free）

> 本仓增量笔记。教科书真源：`extensions/xrk-sunflower-free/README.md` · `docs/configuration.md`「向日葵免费」。

- OFM 对齐：OpenCode 才要 Bun sidecar；**Kilo 永不绑 Bun**（Host→`api.kilo.ai`）。指纹 = UA `2.0.26` + 官方 read/shell + `<env>`，不抄 OC persona。
- Desktop / CLI **不**随包 Bun；无 Bun → 静默跳过 OpenCode，Kilo 仍可。`pnpm vendor:bun` 仅本机调试。
- Host `preserveIds` 必须含 `xrk-sunflower-free`（Desktop 延迟 reconcile 否则 dispose 清 key、zombie brand）。
