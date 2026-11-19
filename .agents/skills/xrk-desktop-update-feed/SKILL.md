---
name: xrk-desktop-update-feed
description: >-
  Desktop 未签名打包、GitHub Release 更新资产（exe+blockmap+yml）、electron-updater
  与手机同款镜像梯子。package:desktop、测自动更新时使用。
  整条发版顺序见 rule xrk-release-flow；npm/GH 副作用见 xrk-release-chain。
  AGT harness-download 已退役 — 不要再 upload-desktop-agt。
---

# Desktop 打包与 GitHub 更新源

## 职责边界（勿与其它文打架）

| 载体 | 只管 |
|------|------|
| rule `xrk-release-flow` | 整条发版**顺序**与硬禁 |
| skill `xrk-release-chain` | npm / GH / stage 掏空根 deps 等**副作用** |
| **本 skill** | Desktop **怎么打**、**怎么挂 GitHub Release**、**怎么核应用内更新** |
| rule/skill `xrk-local-artifacts` | 落点 / ≤5 / subst |
| skill `xrk-github-npm-net` | 直连 vs `127.0.0.1:7897` 选路（**先探再选**） |
| 手机对照 | `XRK-harness-mobile/app/lib/update/`（`update.json` + ghfast 梯子） |

**已退役**：AGT `harness-download` / `_upload-desktop-agt.py` / yml 绝对 AGT URL。

## 何时打包

- 整条发版：必须在 **`pnpm release` 成功且已装回根 `devDeps` 之后**（rule `xrk-release-flow`）。
- **禁止**与 `pnpm release` / `release:stage` / `release:stage:sdk` **并行**。

## 本机落点

| 用途 | 路径 |
|------|------|
| 当前未签名产物（覆盖写） | `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/` |
| 版本快照（≤5） | 同级 `unsigned-artifacts-<ver>/` |
| 上传 stage（≤5） | 同级 `upload-stage-<ver>/` |
| 手测 exe（≤5） | `.release/desktop/<ver>/` |
| **给朋友的副本** | 用户**桌面**根目录一份 `xrk-harness-<ver>-win-x64.exe`（主人明确要求；其它安装包仍禁散落桌面） |

裁剪：`pnpm prune:local`（`--junk` 清 `.release` 杂文件）。

## Windows 路径（NSIS）

1. **优先**已有 ASCII 结 **`C:\xrk-h`** → 本仓：`cd /d C:\xrk-h` 再打包。
2. 没有结时才 `subst X: <仓库根>`，结束（含失败）**必须** `subst X: /d`。
3. 禁止在 `C:\` 造 `xrk-h-upload-*`；禁止残留 Y:/Z:。

```text
XRK_DESKTOP_PACKAGE=1
XRK_DESKTOP_UNSIGNED=1
XRK_DESKTOP_UNSIGNED_UPDATE=1
XRK_DESKTOP_TARGET=win-x64
CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm package:desktop
```

未设 `XRK_DESKTOP_PACKAGE=1` 只写 plan。  
产物：`xrk-harness-<ver>-win-x64-unsigned.exe` + `.blockmap` + `nightly.yml`。  
正式包默认嵌入 `app-update.yml` → **`provider: github`**（`xrkseek/XRK-harness` · `channel: nightly`）。

### 体积判据（0.7.5）

- `electron` / `electron-builder` **只在** Desktop `devDependencies`；运行时依赖仅 `electron-updater`。
- 打完后 `app.asar.unpacked` **不得**含完整 `electron/dist`。
- 正常 exe 约 **190–230MB** 量级。
- electron 二进制下载：GitHub 不通时单命令内联 `HTTPS_PROXY` + `ELECTRON_GET_USE_PROXY=1`（勿落 Host 会话环境）。

## 公开更新源（GitHub Release）

真源：`https://github.com/xrkseek/XRK-harness/releases/tag/vN`

每个 Release **至少**挂：

| 资产 | 说明 |
|------|------|
| `xrk-harness-<ver>-win-x64.exe` | 公开名，**无** `unsigned` |
| `…exe.blockmap` | electron-updater 差分 |
| `nightly.yml` | channel=nightly（应用内默认） |
| `latest.yml` | 与 nightly 同内容（可选但建议） |

### yml 硬规则（GitHub / 镜像梯子）

**保持相对文件名**（对标手机 `update.json` 省略绝对 URL）：

```yaml
version: <ver>
files:
  - url: xrk-harness-<ver>-win-x64.exe
    sha512: <base64>
    size: <bytes>
path: xrk-harness-<ver>-win-x64.exe
sha512: <base64>
releaseDate: '…'
```

- github provider / generic+`…/releases/latest/download` 前缀镜像都能拼出正确下载 URL  
- **不要**再写 AGT `http://…:6969/api/harness/desktop/bin/…` 绝对路径  
- `sha512` 为 **base64**

## 上传（只上 GitHub）

```text
# 改名去 unsigned → upload-stage
gh release upload vN `
  xrk-harness-<ver>-win-x64.exe `
  xrk-harness-<ver>-win-x64.exe.blockmap `
  nightly.yml `
  latest.yml `
  --repo xrkseek/XRK-harness --clobber
```

`scripts/_upload-desktop-agt.py` **已退役**（exit 2）。

## 应用内更新（对齐手机）

| 点 | 桌面 | 手机 |
|----|------|------|
| 字节真源 | 主仓 GH Release | mobile 仓 GH Release |
| 清单 | `nightly.yml` | `update.json` |
| 梯子 | `desktop-update-mirrors.ts`：CN/SEA → ghfast → gh-proxy → github | `update_config.dart` 同序 |
| CONNECT 代理 | 可选 `netSession.setProxy`（Clash / env） | 主要靠前缀镜像 |

## 核对清单

```text
1. gh release view vN --json assets → 含 exe · blockmap · nightly.yml
2. GET https://github.com/…/releases/latest/download/nightly.yml → version = N
3. （CN）GET https://ghfast.top/https://github.com/…/releases/latest/download/nightly.yml → 200
4. 改 apps/site/releases.json win-x64 version/filename → push main
```

## 相关

- 发版顺序：rule `xrk-release-flow`  
- 手机发行：`xrk-mobile-apk`「发行版」  
- 网络：`xrk-github-npm-net`
