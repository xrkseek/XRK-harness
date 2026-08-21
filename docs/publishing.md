# Publishing

> **读者**：维护者。

对外只发 **`@xrkseek/harness-cli`**（含组装好的 `product-web/`）。workspace 内其余包保持 **`private`**，随 CLI deploy 捆绑，不上架。

版本真源：`apps/cli/package.json` → `version`（当前 **0.0.5**）。发行说明：`docs/releases/vX.Y.Z.md`（结构见 rule `xrk-release-notes`）。

## 双通道

| # | 产物 | 去向 | 用户怎么用 |
|---|------|------|------------|
| 1 | npm pack | **npmjs.org** | `npx @xrkseek/harness-cli web` / `npm i -g @xrkseek/harness-cli` |
| 2 | `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release** | 下载离线包 |

不发 GitHub Packages。Release 列表：https://github.com/xrkseek/XRK-harness/releases

## 本机认证

```bash
# npmjs — 用 User 环境变量 NPM_TOKEN（见本机 Cursor 全局规则），或：
npm login --registry=https://registry.npmjs.org
npm whoami

# GitHub Release
gh auth status
```

## 命令

```bash
pnpm release:stage              # 只打到 .release/
pnpm release                    # GitHub Release + npmjs
XRK_RELEASE_SKIP_NPM=1 pnpm release          # 只更 Release
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release   # 只发 npmjs
XRK_RELEASE_SKIP_UPLOAD=1 pnpm release       # 只 stage
```

`XRK_RELEASE_SKIP_PACKAGES=1` 仍可用，等同 `SKIP_NPM`。

## 发版前核对

- [ ] `apps/cli` 版本已 bump；`docs/releases/v…md` 已写（新增/完善/删除/修复）  
- [ ] `NPM_TOKEN` / `npm whoami` 可用；`gh auth status` 正常  
- [ ] `pnpm check` 绿  
- [ ] status / 契约已随用户可见变化更新  
- [ ] 密钥未进产物 / 未进 git  

## 版本线

- **0.0.1** 起为公开线。升版：改 `apps/cli/package.json` → 写发行说明 → `pnpm release`。

完整交接：[maintainer](./maintainer.md)。
