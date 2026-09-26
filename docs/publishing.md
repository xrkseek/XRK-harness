# 发版

> **读者**：维护者

对外发两类产物：

| 包                         | 用途                                             |
| -------------------------- | ------------------------------------------------ |
| **`@xrkseek/harness-cli`** | 含组装好的 `product-web/`；终端用户 `xrkh`       |
| **`@xrkseek/harness`**     | 嵌入式 SDK（`createAgent` 等）；XRK-AGT 等集成方 |

workspace 其余包保持 **`private`**，经 `pnpm deploy` 打进上述两包的 `bundleDependencies`。

版本真源：`apps/cli/package.json` → `version`（SDK stage 会同步 `packages/sdk`）。发行说明：`docs/releases/vX.Y.Z.md`。

## 双通道

| #   | 产物                                                          | 去向               | 用户怎么用                                                    |
| --- | ------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| 1   | npm pack                                                      | **npmjs.org**      | `npm i -g @xrkseek/harness-cli` · `pnpm add @xrkseek/harness` |
| 2   | `xrkseek-harness-cli-<ver>.tgz` · `xrkseek-harness-<ver>.tgz` | GitHub **Release** | 下载离线包 / `pnpm add <tarball-url>`                         |

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
node scripts/npm-prune-withdrawn.mjs            # 撤中间版（保留当前正式 + 预览末号 0.2.7；去掉 preview tag）
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

约定：`MAJOR.MINOR.PATCH` 的 **MINOR（第二位）**——**奇数正式**（`0.3.x`）、**偶数预览**（`0.2.x` · `0.4.x`）。**勿**用 PATCH 奇偶判档；正式线补丁顺序递增（`0.3.10` → `0.3.11`）。

**例外**：预览线**收口号**（去掉 `-rc.N` 后缀的那一个）**接管 `@latest`**。`MINOR=4` 线即如此：`rc.1`–`rc.4` 为过程号，**0.4.0** 收口并接管 `@latest`；下一档进 `MINOR=5` 正式线（`0.5.0`）。

| 档                  | 版本       | 用途                                                           |
| ------------------- | ---------- | -------------------------------------------------------------- |
| **当前（@latest）** | **0.4.12** | `0.4.x` 预览线 npm 终态；`npm i -g @xrkseek/harness-cli@latest` |
| **上一正式线**      | **0.3.11** | npm 仅另留此号供回退                                           |

`0.4.x` 以 **0.4.12** 收口 `@latest`；下一档进 `MINOR=5`（`0.5.0`）。npmjs **只保留 0.4.12 与 0.3.11**（其余 unpublish / deprecate；含 `0.2.7` · `rc.*` · 中间 0.4 补丁）。GitHub Release 文稿可保留历史号。

npm **不能**同号重发；改坏包就升修订号。清理用 `npm-prune-withdrawn.mjs`（先 unpublish，Granular token 失败则 deprecate）。deprecate 消息不得含空格 / 未配对引号；清除弃用须传真正的空字符串（脚本经 `npm-cli.js`）。

预发布号（`-rc.N`）由 `release.mjs` 自动附 `--tag`；收口号与正式版无后缀 ⇒ 落 `@latest`。

GitHub Release 公开页保留 **v0.4.12**（当前）与 **v0.3.11**（上一正式线）；其余历史 Release 可不删。

完整交接：[maintainer](./maintainer.md)。发行说明索引：[releases/](./releases/)。

---

# Publishing

> **Audience**: Maintainers

Two public packages:

| Package                    | Role                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| **`@xrkseek/harness-cli`** | Assembled `product-web/`; end-user `xrkh`                        |
| **`@xrkseek/harness`**     | Embeddable SDK (`createAgent`, …); XRK-AGT and other integrators |

Other workspace packages stay **`private`** and ship via `pnpm deploy` `bundleDependencies`.

Version source of truth: `apps/cli/package.json` → `version` (SDK stage syncs `packages/sdk`). Release notes: `docs/releases/vX.Y.Z.md`.

## Dual channels

| #   | Artifact                                                      | Destination        | How users consume                                             |
| --- | ------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| 1   | npm pack                                                      | **npmjs.org**      | `npm i -g @xrkseek/harness-cli` · `pnpm add @xrkseek/harness` |
| 2   | `xrkseek-harness-cli-<ver>.tgz` · `xrkseek-harness-<ver>.tgz` | GitHub **Release** | Offline tarball / `pnpm add <tarball-url>`                    |

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
node scripts/npm-prune-withdrawn.mjs            # deprecate intermediate versions (keep current formal + last preview 0.2.7; drop preview tag)
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

Rule: in `MAJOR.MINOR.PATCH`, **MINOR (second component) parity** — **odd = formal** (`0.3.x`), **even = preview** (`0.2.x` · `0.4.x`). **Not** PATCH parity; formal-line patches increment in order (`0.3.10` → `0.3.11`).

**Exception**: the **closing number** of a preview line (the one without a `-rc.N` suffix) **takes over `@latest`**. The `MINOR=4` line works exactly that way: `rc.1`–`rc.4` were process numbers, **0.4.0** closes the line and owns `@latest`; the next line moves to the odd `MINOR=5` formal train (`0.5.0`).

| Line                      | Version    | Use                                                                          |
| ------------------------- | ---------- | ---------------------------------------------------------------------------- |
| **Current (@latest)**     | **0.4.12** | `0.4.x` preview-line npm close-out; `npm i -g @xrkseek/harness-cli@latest`   |
| **Previous formal line**  | **0.3.11** | Only other npm pin kept for rollback                                         |

`0.4.x` closes `@latest` at **0.4.12**; next train is `MINOR=5` (`0.5.0`). npmjs **keeps only 0.4.12 and 0.3.11** (everything else unpublished / deprecated, including `0.2.7`, `rc.*`, and intermediate 0.4 patches). GitHub Release notes may retain historical tags.

npm **cannot** republish the same version; bump the patch if a bad pack ships. Clean with `npm-prune-withdrawn.mjs` (unpublish first; deprecate when Granular tokens block). Deprecation messages must not contain spaces / unbalanced quotes; clearing a deprecation requires a real empty string (script uses `npm-cli.js`).

Prereleases (`-rc.N`) get an automatic `--tag` from `release.mjs`; suffix-free versions land on `@latest`.

The GitHub Releases page keeps **v0.4.12** (current) and **v0.3.11** (previous formal line); other historical Releases need not be deleted.

Full handoff: [maintainer](./maintainer.md). Release notes index: [releases/](./releases/).
