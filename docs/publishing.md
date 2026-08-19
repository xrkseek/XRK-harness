# Publishing

对外只发 **`@xrkseek/harness-cli`**（壳在包内 `product-web/`）。其余 workspace 包保持 `private`。

## 产物

| 产物 | 路径 / 通道 |
|------|-------------|
| 发行版 | GitHub Release 附件 `.release/xrkseek-harness-cli-<ver>.tgz`（含运行时 + `product-web`） |
| 包 | GitHub Packages：`@xrkseek/harness-cli` |

```bash
pnpm release:stage          # 组装 · deploy · 打 tarball
pnpm release                # stage 后：创建 Release + 发 Packages
```

需要 `gh` 已登录、以及 `GITHUB_TOKEN`（`contents:write` · `packages:write`）。

```ini
# 消费 Packages
@xrkseek:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

```sh
npx @xrkseek/harness-cli web
# 或解压发行版后：
node dist/bin.js web
```
