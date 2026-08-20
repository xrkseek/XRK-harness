# Publishing

> **读者**：维护者。

对外发布 **`@xrkseek/harness-cli`**（内含组装好的 `product-web/`）。workspace 内其余包保持 **`private`**，不随本次流程公开到 npm。

## 产物

| 产物 | 上传到哪里 | 用户怎么用 |
|------|------------|------------|
| `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release** | 下载解压或按 Release 说明安装 |
| `npm pack` 产物 | GitHub **Packages** | `npx @xrkseek/harness-cli`（需配置 registry + token） |

Release 列表：https://github.com/xrkseek/XRK-harness/releases

## 命令

```bash
pnpm release:stage              # 只打到 .release/
pnpm release                    # stage + GitHub Release + Packages
XRK_RELEASE_SKIP_PACKAGES=1 pnpm release   # 只更 Release
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release # 只更 Packages
```

## GitHub Packages 认证（维护者本机 / CI）

```ini
@xrkseek:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

用户侧安装示例（需已有读 Packages 权限）：

```sh
npx @xrkseek/harness-cli web
```

## 发版前核对

- [ ] Node ≥26；本机 pnpm 与 `packageManager` 一致（`npm install -g pnpm@…`）  
- [ ] `pnpm check` 绿  
- [ ] 若有用户可见行为变化：已更新 [status](./status.md) 与相关契约  
- [ ] [releases/](./releases/) 有对应说明（或明确本版只修包无文档章）  
- [ ] 密钥未进产物 / 未进 git  

完整交接清单：[maintainer](./maintainer.md)。
