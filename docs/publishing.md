# 发版

> **读者**：维护者

对外发两类产物：

| 包 | 用途 |
|----|------|
| **`@xrkseek/harness-cli`** | 含组装好的 `product-web/`；终端用户 `xrkh` |
| **`@xrkseek/harness`** | 嵌入式 SDK（`createAgent` 等）；XRK-AGT 等集成方 |

workspace 其余包保持 **`private`**，经 `pnpm deploy` 打进上述两包的 `bundleDependencies`。

版本真源：`apps/cli/package.json` → `version`（SDK stage 会同步 `packages/sdk`）。发行说明：`docs/releases/vX.Y.Z.md`。

## 双通道

| # | 产物 | 去向 | 用户怎么用 |
|---|------|------|------------|
| 1 | npm pack | **npmjs.org** | `npm i -g @xrkseek/harness-cli` · `pnpm add @xrkseek/harness` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` · `xrkseek-harness-<ver>.tgz` | GitHub **Release** | 下载离线包 / `pnpm add <tarball-url>` |

不发 GitHub Packages。发布页：https://github.com/xrkseek/XRK-harness/releases

## 本机认证

```bash
npm login --registry=https://registry.npmjs.org   # 或 User env NPM_TOKEN
npm whoami
gh auth status

# 账号开启 write 2FA 时：6 位认证器码，或单条 64 字符 recovery code
export NPM_CONFIG_OTP=123456   # PowerShell: $env:NPM_CONFIG_OTP="123456"
```

`pnpm release` 会把 `NPM_CONFIG_OTP` / `NPM_OTP` 传给 `npm publish --otp`。发版脚本**不改写** workspace `package.json`（SDK 版本号除外，与 CLI 对齐）。

## 命令

```bash
pnpm release:stage                              # CLI → .release/
pnpm release:stage:sdk                          # SDK → .release/harness + tgz
pnpm release                                    # GitHub Release + npmjs（CLI + SDK）
XRK_RELEASE_SKIP_SDK=1 pnpm release             # 仅 CLI
XRK_RELEASE_SKIP_NPM=1 pnpm release             # 仅 GitHub
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release      # 仅 npmjs
node scripts/npm-prune-withdrawn.mjs            # 撤中间版（保留 formal + 0.0.11）
```

## 发版前核对

- [ ] `apps/cli` 版本已 bump；`docs/releases/v…md` 已写
- [ ] 根 **README.md**「现在能用到什么程度」与 FAQ 已与 [status.md](./status.md) 对齐（版本号 · 能跑/未稳）
- [ ] `NPM_TOKEN` / `npm whoami`；`gh auth status`
- [ ] `pnpm check` 绿；status / 契约已同步
- [ ] stage 日志含 `sharp platform packages`；`.release/harness-cli/node_modules/@img/sharp-linux-x64` 存在
- [ ] `.release/harness/dist/index.js` 与 `xrkseek-harness-<ver>.tgz` 存在（未 `SKIP_SDK`）
- [ ] 密钥未进产物 / git

## 版本线

| 档 | 版本 | 用途 |
|------|------|------|
| **正式** | **0.1.29** | 当前推荐 |
| **预览** | **0.0.11** | npm tag **`preview`** |

npm **不能**同号重发；改坏包就升修订号。中间号用 `npm-prune-withdrawn.mjs` deprecate（Granular token 通常无法 unpublish）。**勿**用空格 / 乱引号 deprecate——会破坏 registry 元数据；清弃用必须传真正的空字符串（脚本经 `npm-cli.js` 处理，避免 Windows `npm.cmd` 吞掉空参）。

完整交接：[maintainer](./maintainer.md)。发行说明索引：[releases/](./releases/)。

---

# Publishing

> **Audience**: Maintainers

Two public packages:

| Package | Role |
|---------|------|
| **`@xrkseek/harness-cli`** | Assembled `product-web/`; end-user `xrkh` |
| **`@xrkseek/harness`** | Embeddable SDK (`createAgent`, …); XRK-AGT and other integrators |

Other workspace packages stay **`private`** and ship via `pnpm deploy` `bundleDependencies`.

Version source of truth: `apps/cli/package.json` → `version` (SDK stage syncs `packages/sdk`). Release notes: `docs/releases/vX.Y.Z.md`.

## Dual channels

| # | Artifact | Destination | How users consume |
|---|----------|-------------|-------------------|
| 1 | npm pack | **npmjs.org** | `npm i -g @xrkseek/harness-cli` · `pnpm add @xrkseek/harness` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` · `xrkseek-harness-<ver>.tgz` | GitHub **Release** | Offline tarball / `pnpm add <tarball-url>` |

Do not publish to GitHub Packages. Releases: https://github.com/xrkseek/XRK-harness/releases

## Local auth

```bash
npm login --registry=https://registry.npmjs.org   # or User env NPM_TOKEN
npm whoami
gh auth status

# When the account has write 2FA: 6-digit authenticator code, or a single 64-char recovery code
export NPM_CONFIG_OTP=123456   # PowerShell: $env:NPM_CONFIG_OTP="123456"
```

`pnpm release` forwards `NPM_CONFIG_OTP` / `NPM_OTP` to `npm publish --otp`. The release script does **not** rewrite workspace `package.json` (except SDK version aligned to CLI).

## Commands

```bash
pnpm release:stage                              # CLI → .release/
pnpm release:stage:sdk                          # SDK → .release/harness + tgz
pnpm release                                    # GitHub Release + npmjs (CLI + SDK)
XRK_RELEASE_SKIP_SDK=1 pnpm release             # CLI only
XRK_RELEASE_SKIP_NPM=1 pnpm release             # GitHub only
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release      # npmjs only
node scripts/npm-prune-withdrawn.mjs            # deprecate intermediate versions (keep formal + 0.0.11)
```

## Pre-release checklist

- [ ] `apps/cli` version bumped; `docs/releases/v…md` written
- [ ] Root **README.md** maturity table + FAQ aligned with [status.md](./status.md) (version · Working/Unstable)
- [ ] `NPM_TOKEN` / `npm whoami`; `gh auth status`
- [ ] `pnpm check` green; status / contracts synced
- [ ] stage log includes `sharp platform packages`; `.release/harness-cli/node_modules/@img/sharp-linux-x64` exists
- [ ] `.release/harness/dist/index.js` and `xrkseek-harness-<ver>.tgz` exist (unless `SKIP_SDK`)
- [ ] secrets not in artifacts / git

## Version line

| Line | Version | Use |
|------|---------|-----|
| **Formal** | **0.1.29** | Current recommended |
| **Preview** | **0.0.11** | npm tag **`preview`** |

npm **cannot** republish the same version; bump the patch if a bad pack ships. Deprecate intermediate numbers with `npm-prune-withdrawn.mjs` (Granular tokens usually cannot unpublish). **Do not** deprecate with spaces / broken quotes — that corrupts registry metadata; clearing a deprecation requires a real empty string (the script goes through `npm-cli.js` so Windows `npm.cmd` does not swallow the empty arg).

Full handoff: [maintainer](./maintainer.md). Release notes index: [releases/](./releases/).
