# XRK Harness 下载页

> **读者**：维护者

Cloudflare **Worker**（不是 Pages 静态站）：`GET /` 在边缘拉 AGT 目录，渲染产品壳（浅色 / 深色 / 跟随系统）+ 可点预置干员；Windows 下载、macOS 标明不支持；页脚挂 GitHub / npm。安装包走 302 到 AGT `:6969`。

```bash
npx wrangler deploy --config apps/site/wrangler.toml
```

控制台选 **Workers**，项目名 `xrk-harness-download`。改 origin 用 `wrangler.toml` 的 `HARNESS_ORIGIN`。干员名册与 `seedGlobalRosterMembers` 对齐。

---

# XRK Harness download page

> **Audience**: Maintainers

Cloudflare **Worker** (not a static Pages site). `GET /` fetches the AGT catalog and renders the product shell (light / dark / system) plus a clickable seed roster. Windows is the only desktop download; macOS is listed as unsupported. GitHub and npm are in the nav. Installer bytes redirect to AGT `:6969`.

```bash
npx wrangler deploy --config apps/site/wrangler.toml
```
