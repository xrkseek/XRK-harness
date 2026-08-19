# packages/client

DSH Web 客户端包二次创作（与 `apps/web` 成对）。归因见 [`apps/web/NOTICE`](../../apps/web/NOTICE)。

`pnpm client:bundle` 用 tsdown 编出各包 `lib/client.js`（gitignore）。`pnpm web:assemble` 把它们装进 `apps/web/dist/plugins`。缺 lib 时设 `XRK_UI_SRC`。
