# 发版

> **读者**：维护者

对外只发 **`@xrkseek/harness-cli`**（含组装好的 `product-web/`）。workspace 其余包保持 **`private`**，随 CLI 捆绑。

版本真源：`apps/cli/package.json` → `version`。发行说明：`docs/releases/vX.Y.Z.md`。

## 双通道

| # | 产物 | 去向 | 用户怎么用 |
|---|------|------|------------|
| 1 | npm pack | **npmjs.org** | `npx @xrkseek/harness-cli web` / `npm i -g @xrkseek/harness-cli` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release** | 下载离线包 |

不发 GitHub Packages。发布页：https://github.com/xrkseek/XRK-harness/releases

## 本机认证

```bash
npm login --registry=https://registry.npmjs.org   # 或 User env NPM_TOKEN
npm whoami
gh auth status

# 账号开启 write 2FA 时：6 位认证器码，或单条 64 字符 recovery code
export NPM_CONFIG_OTP=123456   # PowerShell: $env:NPM_CONFIG_OTP="123456"
```

`pnpm release` 会把 `NPM_CONFIG_OTP` / `NPM_OTP` 传给 `npm publish --otp`。发版脚本**不改写** workspace `package.json`。

## 命令

```bash
pnpm release:stage                              # → .release/
pnpm release                                    # GitHub Release + npmjs
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
- [ ] 密钥未进产物 / git

## 版本线

| 档 | 版本 | 用途 |
|------|------|------|
| **正式** | **0.1.17** | 当前推荐 |
| **预览** | **0.0.11** | npm tag **`preview`** |

npm **不能**同号重发；改坏包就升修订号。中间号用 `npm-prune-withdrawn.mjs` deprecate（Granular token 通常无法 unpublish）。**勿**用空格 / 乱引号 deprecate——会破坏 registry 元数据；清弃用必须传真正的空字符串（脚本经 `npm-cli.js` 处理，避免 Windows `npm.cmd` 吞掉空参）。

完整交接：[maintainer](./maintainer.md)。发行说明索引：[releases/](./releases/)。

---

# Publishing

> **Audience**: Maintainers

Only **`@xrkseek/harness-cli`** is published (including assembled `product-web/`). Other workspace packages stay **`private`** and ship bundled with the CLI.

Version source of truth: `apps/cli/package.json` → `version`. Release notes: `docs/releases/vX.Y.Z.md`.

## Dual channels

| # | Artifact | Destination | How users consume |
|---|----------|-------------|-------------------|
| 1 | npm pack | **npmjs.org** | `npx @xrkseek/harness-cli web` / `npm i -g @xrkseek/harness-cli` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release** | Offline tarball download |

Do not publish to GitHub Packages. Releases: https://github.com/xrkseek/XRK-harness/releases

## Local auth

```bash
npm login --registry=https://registry.npmjs.org   # or User env NPM_TOKEN
npm whoami
gh auth status

# When the account has write 2FA: 6-digit authenticator code, or a single 64-char recovery code
export NPM_CONFIG_OTP=123456   # PowerShell: $env:NPM_CONFIG_OTP="123456"
```

`pnpm release` forwards `NPM_CONFIG_OTP` / `NPM_OTP` to `npm publish --otp`. The release script does **not** rewrite workspace `package.json`.

## Commands

```bash
pnpm release:stage                              # → .release/
pnpm release                                    # GitHub Release + npmjs
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
- [ ] secrets not in artifacts / git

## Version line

| Line | Version | Use |
|------|---------|-----|
| **Formal** | **0.1.17** | Current recommended |
| **Preview** | **0.0.11** | npm tag **`preview`** |

npm **cannot** republish the same version; bump the patch if a bad pack ships. Deprecate intermediate numbers with `npm-prune-withdrawn.mjs` (Granular tokens usually cannot unpublish). **Do not** deprecate with spaces / broken quotes — that corrupts registry metadata; clearing a deprecation requires a real empty string (the script goes through `npm-cli.js` so Windows `npm.cmd` does not swallow the empty arg).

Full handoff: [maintainer](./maintainer.md). Release notes index: [releases/](./releases/).
