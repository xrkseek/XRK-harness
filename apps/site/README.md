# XRK Harness 下载页

> **读者**：维护者

Cloudflare **Worker**（不是 Pages 静态站）：`GET /` 渲染产品壳。

| 安装包 | 来源 |
|--------|------|
| Windows x64 | GitHub Release **`xrkseek/XRK-harness`** |
| Android arm64 | GitHub Release **`xrkseek/XRK-harness-mobile`**（`releases.json` 的 `android-arm64` + `githubRepo`） |
| macOS | 页上合并为一条 `xrkh web` 提示（无安装包按钮） |

**中国时区**（或 CF 国家 CN·HK·MO·TW）默认中文页 + 镜像加速（GitHub 直连为第二按钮）；**其它时区**默认英文页 + 原生 GitHub。壳内 **electron-updater** 仍读 AGT（`HARNESS_ORIGIN`）；手机应用内更新读 mobile 仓 `update.json`，不经本 Worker。

发版后改 [`releases.json`](./releases.json) 的 `version` / `filename`（桌面与手机同号时两边都改），再部署 Worker。

控制台选 **Workers**，项目名 `xrk-harness`（`wrangler.toml` 的 `name`）。构建根目录 `apps/site`。可选 env：`HARNESS_ORIGIN`（更新源 / 目录）、`GITHUB_PROXY_PREFIX`（默认 `https://ghfast.top/`）。

---

# XRK Harness download page

> **Audience**: Maintainers

Cloudflare **Worker** (not Pages).

| Installer | Source |
|-----------|--------|
| Windows x64 | GitHub Release **`xrkseek/XRK-harness`** |
| Android arm64 | GitHub Release **`xrkseek/XRK-harness-mobile`** (`android-arm64` + `githubRepo` in `releases.json`) |
| macOS | One tip row pointing at `xrkh web` (no installer button) |

**China-ish TZ / CF CN·HK·MO·TW**: Chinese page + mirror primary (GitHub secondary). **Everyone else**: English page + native GitHub. Desktop **electron-updater** still uses AGT (`HARNESS_ORIGIN`). The phone App reads `update.json` from the mobile repo — not this Worker.

After a release, bump `version` / `filename` in [`releases.json`](./releases.json) (desktop and phone when they share a number), then deploy the Worker.

Workers project name `xrk-harness`. Build root `apps/site`. Optional env: `HARNESS_ORIGIN`, `GITHUB_PROXY_PREFIX` (default `https://ghfast.top/`).
