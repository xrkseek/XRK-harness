# apps/web

产品聊天壳（DSH Web 二次创作，与 [`packages/client`](../../packages/client/) 成对）。

归因：[NOTICE](./NOTICE) · [UPSTREAM](./UPSTREAM)。本仓根 [LICENSE](../../LICENSE)。

品牌在 `public/`。`serve` 托管本目录 `dist/`（gitignore）。暂不进 pnpm workspace；自包含编出未齐前，在对照仓编出后把产物放进本目录 `dist/`，或设 `XRK_WEB_DIST`。Face 验证台见 [`apps/console`](../console/)。
