# XRK Harness 下载页

> **读者**：维护者

Cloudflare **Worker**（不是 Pages 静态站）：`GET /` 在边缘拉目录，渲染产品壳（浅色 / 深色 / 跟随系统）+ 可点预置干员；Windows 下载、macOS 标明不支持；页脚挂 GitHub / npm。安装包 302 到 `HARNESS_ORIGIN`（HTTPS 反代 AGT `:6969`，默认 `https://xrk.siphot.com`）。

```bash
npx wrangler deploy --config apps/site/wrangler.toml
```

控制台选 **Workers**，项目名 `xrk-harness`（`wrangler.toml` 的 `name`）。构建根目录设 `apps/site`。改 origin 用 `HARNESS_ORIGIN`。干员名册与 `seedGlobalRosterMembers` 对齐。

---

# XRK Harness download page

> **Audience**: Maintainers

Cloudflare **Worker** (not a static Pages site). `GET /` fetches the catalog and renders the product shell (light / dark / system) plus a clickable seed roster. Windows is the only desktop download; macOS is listed as unsupported. GitHub and npm are in the nav. Installer bytes 302 to `HARNESS_ORIGIN` (HTTPS front for AGT `:6969`, default `https://xrk.siphot.com`).

```bash
npx wrangler deploy --config apps/site/wrangler.toml
```

In the dashboard pick **Workers**, project name `xrk-harness` (the `name` in `wrangler.toml`). Set the build root to `apps/site`. Change origin with `HARNESS_ORIGIN`.
