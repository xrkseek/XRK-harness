# 发版 / Publishing

> **读者 / Audience**：维护者 / Maintainers

对外只发 **`@xrkseek/harness-cli`**（含组装好的 `product-web/`）。workspace 内其余包保持 **`private`**，随 CLI deploy 捆绑，不上架。

Only **`@xrkseek/harness-cli`** is published externally (including assembled `product-web/`). Other workspace packages stay **`private`** and ship bundled with the CLI.

版本真源：`apps/cli/package.json` → `version`。发行说明：`docs/releases/vX.Y.Z.md`（结构见 rule `xrk-release-notes`）。

Version source of truth: `apps/cli/package.json` → `version`. Release notes: `docs/releases/vX.Y.Z.md`.

## 双通道 / Dual channels

| # | 产物 / Artifact | 去向 / Destination | 用户怎么用 / How users consume |
|---|------|------|------------|
| 1 | npm pack | **npmjs.org** | `npx @xrkseek/harness-cli web` / `npm i -g @xrkseek/harness-cli` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release** | 下载离线包 / Download offline tarball |

不发 GitHub Packages。Release 列表：https://github.com/xrkseek/XRK-harness/releases

Do not publish to GitHub Packages.

## 本机认证 / Local auth

```bash
# npmjs — User env NPM_TOKEN, or:
npm login --registry=https://registry.npmjs.org
npm whoami

# GitHub Release
gh auth status
```

## 命令 / Commands

```bash
pnpm release:stage              # stage only → .release/
pnpm release                    # GitHub Release + npmjs
XRK_RELEASE_SKIP_NPM=1 pnpm release          # Release only
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release   # npmjs only
XRK_RELEASE_SKIP_UPLOAD=1 pnpm release       # stage only
```

`XRK_RELEASE_SKIP_PACKAGES=1` 仍可用，等同 `SKIP_NPM`。

## 发版前核对 / Pre-release checklist

- [ ] `apps/cli` 版本已 bump；`docs/releases/v…md` 已写（新增/完善/删除/修复）  
- [ ] `NPM_TOKEN` / `npm whoami` 可用；`gh auth status` 正常  
- [ ] `pnpm check` 绿  
- [ ] status / 契约已随用户可见变化更新  
- [ ] 密钥未进产物 / 未进 git  

## 版本线 / Version line

公开发包只保留两档：

Only two published lines are kept:

| 档 / Line | 版本 / Version | 用途 / Use |
|------|------|------|
| **正式 / Formal** | **0.1.0** | 当前推荐 / Recommended |
| **预览 / Preview** | **0.0.11** | 历史预览唯一保留 / Sole retained preview |

升正式版：改 `apps/cli/package.json` → 写 `docs/releases/v…md` → `pnpm release`。中间修订号不要堆积；需重发同一正式号时先撤下远程同名 Release / npm 版本再发。

To ship a formal release: bump `apps/cli/package.json` → write `docs/releases/v…md` → `pnpm release`. Do not pile intermediate patch numbers; to republish the same formal version, remove the remote Release / npm version first.

**npm unpublish**：本机 `NPM_TOKEN` 若为「绕过 2FA 的 Granular token」，**不能** `npm unpublish`（403）。请在 [npmjs 包页](https://www.npmjs.com/package/@xrkseek/harness-cli) 用账号会话删除多余版本，或换用 **Classic** Automation token / 带 OTP 的登录后再 unpublish，然后 `XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release` 重发正式号。无法立即删除时，对撤下版本执行 `npm deprecate`（文案指向 `0.1.0` / `0.0.11`）。

**npm unpublish**: Granular tokens that bypass 2FA **cannot** unpublish (403). Delete withdrawn versions in the npm website session, or use a **Classic** Automation token / OTP login, then republish with `XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release`. If deletion must wait, `npm deprecate` withdrawn versions toward `0.1.0` / `0.0.11`.

完整交接 / Full handoff：[maintainer](./maintainer.md)。
