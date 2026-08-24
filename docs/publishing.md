# 发版 / Publishing

> **读者 / Audience**：维护者 / Maintainers

对外只发 **`@xrkseek/harness-cli`**（含组装好的 `product-web/`）。workspace 其余包保持 **`private`**，随 CLI 捆绑。

Only **`@xrkseek/harness-cli`** is published (including assembled `product-web/`). Other workspace packages stay **`private`**.

版本真源：`apps/cli/package.json` → `version`。发行说明：`docs/releases/vX.Y.Z.md`。

Version source of truth: `apps/cli/package.json` → `version`. Release notes: `docs/releases/vX.Y.Z.md`.

## 双通道 / Dual channels

| # | 产物 / Artifact | 去向 / Destination | 用户怎么用 / How users consume |
|---|------|------|------------|
| 1 | npm pack | **npmjs.org** | `npx @xrkseek/harness-cli web` / `npm i -g @xrkseek/harness-cli` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release** | 下载离线包 / Offline tarball |

不发 GitHub Packages。https://github.com/xrkseek/XRK-harness/releases

## 本机认证 / Local auth

```bash
npm login --registry=https://registry.npmjs.org   # 或 User env NPM_TOKEN
npm whoami
gh auth status

# 账号开启 write 2FA 时：6 位认证器码，或单条 64 字符 recovery code
export NPM_CONFIG_OTP=123456   # PowerShell: $env:NPM_CONFIG_OTP="123456"
```

`pnpm release` 会把 `NPM_CONFIG_OTP` / `NPM_OTP` 传给 `npm publish --otp`。发版脚本**不改写** workspace `package.json`。

## 命令 / Commands

```bash
pnpm release:stage                              # → .release/
pnpm release                                    # GitHub Release + npmjs
XRK_RELEASE_SKIP_NPM=1 pnpm release             # 仅 GitHub
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release      # 仅 npmjs
node scripts/npm-prune-withdrawn.mjs            # 撤中间版（保留 formal + 0.0.11）
```

## 发版前核对 / Pre-release checklist

- [ ] `apps/cli` 版本已 bump；`docs/releases/v…md` 已写  
- [ ] `NPM_TOKEN` / `npm whoami`；`gh auth status`  
- [ ] `pnpm check` 绿；status / 契约已同步  
- [ ] stage 日志含 `sharp platform packages`；`.release/harness-cli/node_modules/@img/sharp-linux-x64` 存在  
- [ ] 密钥未进产物 / git  

## 版本线 / Version line

| 档 / Line | 版本 / Version | 用途 / Use |
|------|------|------|
| **正式 / Formal** | **0.1.8** | 当前推荐 / Recommended |
| **预览 / Preview** | **0.0.11** | npm tag **`preview`** |

npm **不能**同号重发；改坏包就升修订号。中间号用 `npm-prune-withdrawn.mjs` deprecate（Granular token 通常无法 unpublish）。**勿**用空格 / 乱引号 deprecate——会破坏 registry 元数据；清弃用必须传真正的空字符串（脚本经 `npm-cli.js` 处理，避免 Windows `npm.cmd` 吞掉空参）。

完整交接：[maintainer](./maintainer.md)。
