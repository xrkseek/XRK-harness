# apps/web

产品聊天壳（DSH Web 二次创作，与 [`packages/client`](../../packages/client/) 成对）。

归因：[NOTICE](./NOTICE) · [UPSTREAM](./UPSTREAM)。本仓根 [LICENSE](../../LICENSE)。

品牌在 `public/`。编出到 `dist/`（gitignore）：

```bash
pnpm web:build
pnpm client:bundle
pnpm web:assemble
```

- `web:build`：本仓 Vite SPA
- `client:bundle`：本仓 tsdown 编出各插件 `lib/client.js`（省略 HMR / Cordis UI）
- `web:assemble`：按各包 `xrk.client` 把 `packages/client/*/lib/client.js` 与 Face 立即层 `packages/stubs/xrk-{typert-registry,api-gateway,api-remotes}/lib/client.js` 装进 `dist/plugins/@xrkseek/...` 并写 `boot.json`（34 条；omit HMR / Cordis UI / native picker）

Host 有完整 dist 时跑 `packages/server/host/tests/product-shell.test.ts`（GET `/` · boot · plugin 200 · 首屏 RPC）。Host-serve 硬刷：`pnpm test:web`（`tests/product-shell-*.e2e.ts`，不进 `pnpm check`）。Playwright 是本包 devDependency；浏览器不随 `pnpm install` 下来，要跑硬刷时：

```bash
pnpm --filter @xrkseek/web-frontend exec playwright install chromium
```

裸 `vite` / `pnpm --filter @xrkseek/web-frontend dev` 在 config 钩子拒绝（`apps/web/tests/vite-entry.test.ts`）。缺本仓 `lib/client.js` 时，`web:assemble` 仍可设 `XRK_UI_SRC` 指向对照仓树作回退。

Cordis 薄栈：`packages/cordis*` · `cosmokit` · `schemastery`。缺的主机面包暂用 `packages/stubs/*`。Face 验证台见 [`apps/console`](../console/)。
