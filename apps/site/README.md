# XRK Harness 下载页

> **读者**：维护者

Cloudflare Pages：**静态壳 + Functions** 把 `/api/harness/*` 反代到 AGT `http://<host>:6969`（目录 JSON 走 HTTPS；大安装包仍直链 `downloadOrigin`，避免 Functions 体积上限）。

```bash
npx wrangler pages deploy apps/site --project-name xrk-harness-download
```

改 `wrangler.toml` / `functions/api/harness/_middleware.js` 里的 origin，以及 `config.js` 的 `downloadOrigin`。Windows 不用 Cloudflare 的 `[[path]].js` 文件名。

---

# XRK Harness download page

> **Audience**: Maintainers

Cloudflare Pages with a Function that proxies `/api/harness/*` to AGT :6969. Installer bytes still use `downloadOrigin` on the AGT host.
