# apps/web

产品聊天壳（DSH Web 二次创作，与 [`packages/client`](../../packages/client/) 成对）。

归因：[NOTICE](./NOTICE) · [UPSTREAM](./UPSTREAM)。本仓根 [LICENSE](../../LICENSE)。

品牌在 `public/`。编出：

```bash
pnpm --filter @deepseek-ai/dsh-web-frontend run build
```

得到 `dist/`（gitignore）。Cordis 薄栈：`packages/cordis*` · `cosmokit` · `schemastery`。缺的主机面包暂用 `packages/stubs/*`。完整产品壳还须 `boot.json` + `plugins/**/client.js`。Face 验证台见 [`apps/console`](../console/)。
