# XRK Harness 下载页

> **读者**：维护者

Cloudflare **Worker**（不是 Pages 静态站）：`GET /` 渲染产品壳。Windows 安装包在 **GitHub Release**；**中国时区**（或 CF 国家 CN·HK·MO·TW）默认中文页 + 镜像加速（GitHub 直连为第二按钮）；**其它时区**默认英文页 + 原生 GitHub。壳内 **electron-updater** 仍读 AGT（`HARNESS_ORIGIN`）。

控制台选 **Workers**，项目名 `xrk-harness`（`wrangler.toml` 的 `name`）。构建根目录 `apps/site`。可选 env：`HARNESS_ORIGIN`（更新源 / 目录）、`GITHUB_PROXY_PREFIX`（默认 `https://ghfast.top/`）。

---

# XRK Harness download page

> **Audience**: Maintainers

Cloudflare **Worker** (not Pages). Windows installers are **GitHub Release** assets. **China-ish TZ / CF CN·HK·MO·TW**: Chinese page + mirror primary (GitHub secondary). **Everyone else**: English page + native GitHub. Desktop **electron-updater** still uses AGT (`HARNESS_ORIGIN`).

Workers project name `xrk-harness`. Build root `apps/site`. Optional env: `HARNESS_ORIGIN`, `GITHUB_PROXY_PREFIX` (default `https://ghfast.top/`).
