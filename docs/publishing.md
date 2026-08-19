# Publishing

对外 **`@xrkseek/harness-cli`**（`product-web/`）。workspace 其余包 `private`。

| 产物 | 上传到哪里 |
|------|------------|
| `xrkseek-harness-cli-<ver>.tgz` | GitHub **Release**（解压即用） |
| `npm pack` 产物 | GitHub **Packages** |

```bash
pnpm release:stage              # 只打 .release/
pnpm release                    # stage + Release + Packages
XRK_RELEASE_SKIP_PACKAGES=1 pnpm release   # 只更 Release
XRK_RELEASE_SKIP_GH_RELEASE=1 pnpm release # 只更 Packages
```

```ini
@xrkseek:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

```sh
npx @xrkseek/harness-cli web
```

Release：https://github.com/xrkseek/XRK-harness/releases
