---
name: xrk-desktop-update-feed
description: >-
  XRK-Harness Desktop 未签名测包、electron-updater 测试源、harness-download
  落盘与发新版必上传。测自动更新（本机低版本装、服务器高版本喂）、
  package:desktop / upload:desktop、把 exe 放到桌面时使用。
---

# Desktop 测试更新源

发 **新桌面版必须上测试更新源**。只打本机 exe、不 PUT，装旧版的人拉不到更新。

机相关落点（测试 origin、VPS 数据根、SSH 同步命令）写同目录 **`local.md`**，已 gitignore，**不入库**。缺 `local.md` 时只认 env `XRK_DESKTOP_UPDATE_TEST_ORIGIN`。

## When to Use

- `pnpm package:desktop` / `pnpm upload:desktop` / 桌面包放到桌面
- 用户说测自动更新、打低版本、服务器喂高版本
- 改 `XRK_DESKTOP_UPDATE_*`、`harness-download-Core`、Cloudflare 下载页 origin

## 公开面（测试频道）

Origin（无尾斜杠）来自 `local.md` 或 `XRK_DESKTOP_UPDATE_TEST_ORIGIN`。路径：

| 用途 | 相对 origin |
|------|-------------|
| 目录 | `GET /releases` |
| 该平台最新安装包 | `GET /download/win-x64` |
| 更新 YAML | `GET /desktop/win-x64/nightly.yml`（另有 `latest.yml`） |
| exe / blockmap | `GET /desktop/bin/win-x64/<file>` |

`app-update.yml` generic `url` = origin + `/desktop/win-x64`。

Cloudflare 页：`apps/site`。安装包字节不走 CF。

AGT：`harness-download-Core`。监听 **0.0.0.0:6969**。改 Core 后 `pnpm build` 并重启 AGT。

## 服务器落盘

与本机 `apps/desktop/.desktop-build/upload-mirror/test/` **同构**（数据根见 `local.md`）：

```text
harness-download/
  desktop/win-x64/nightly.yml
  desktop/win-x64/latest.yml
  desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe
  desktop/bin/win-x64/*.blockmap
```

公开安装包文件名不要带 `unsigned`。SSH 同步命令只写在 `local.md`。密码不入库、不回显。

## 本机 env

`apps/desktop/.env.windows`（gitignore）：

- `XRK_DESKTOP_UNSIGNED=1`
- `XRK_DESKTOP_UNSIGNED_UPDATE=1`（未签名包才写入更新源；否则 updater 不检查）
- `XRK_DESKTOP_AUTO_UPDATE_ENV=test`
- `XRK_DESKTOP_UPDATE_TEST_ORIGIN`（测试源 origin）
- upload dummy：`XRK_DESKTOP_UPLOAD_TEST_BUCKET` / `SECRET_ID` / `SECRET_KEY`（本机 filesystem mirror 仍要求这三项有值）

## 打包（NSIS + 非 ASCII 路径）

NSIS 不能往非 ASCII 路径写 exe。不要在盘符根做 `mklink /J` 展开整仓。用临时盘符 `subst`（占用就换字母），cwd 用仓库根、命令里只有 ASCII。完成后 `subst <盘符>: /d`。产物复制到用户桌面，不要另建残留安装目录。

从 subst 盘符：

```text
XRK_DESKTOP_PACKAGE=1
XRK_DESKTOP_UNSIGNED=1
XRK_DESKTOP_UNSIGNED_UPDATE=1
XRK_DESKTOP_TARGET=win-x64
CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm package:desktop
```

不设 `XRK_DESKTOP_PACKAGE=1` 只写 plan、不产包。约 8–15 分钟；nsis 阶段日志可能长时间不动。

产物：`apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`  
`xrk-harness-<ver>-win-x64-unsigned.exe` + `.blockmap` + `nightly.yml` + `package-complete-win-x64.json`

Cursor 若锁住旧 `win-unpacked/resources/app.asar`（electron-builder `EBUSY`），打包和 `upload:desktop` 都设 `XRK_DESKTOP_UNSIGNED_ARTIFACTS_DIR=unsigned-artifacts-<ver>` 换输出目录。打完上传后删掉多余 `unsigned-artifacts-*` 与 `upload-chunks/`。

## 发新版（必上传）

1. `apps/desktop/package.json` 已是要发布的版本 **N**
2. `pnpm package:desktop`（上节）
3. `XRK_DESKTOP_UNSIGNED=1 pnpm upload:desktop -- win-x64` → 写本机 mirror
4. 按 `local.md` 把 `upload-mirror/test` 同步到更新源数据根
5. `GET …/desktop/win-x64/nightly.yml` 的 `version:` 必须是 **N**（先于本机安装包）
6. 安装包复制到桌面（可选）

**不要**把刚打的低版本测包再 upload，否则源会被降级。

## 测自动更新

目标：本机装 **N-1**，源上是 **N**，Settings 底栏 Host 重连槽出现更新芯片。

1. 先按「发新版」把 **N** 推上服务器并确认 `nightly.yml`
2. 把 `apps/desktop/package.json` **临时**改成 **N-1**（只改这一处版本）
3. 再 `package:desktop`（带 `UNSIGNED_UPDATE=1`，这样 N-1 里才有 Settings 更新条 + feed）
4. **禁止** upload 这一包
5. 把 N-1 的 exe 拷到桌面，把 `package.json` **改回 N**
6. 用户：卸掉更高版本（若已装）→ 装桌面上的 N-1 → 打开 → 底栏 Settings 旁，无 Host 重连条时应看到版本 /「有更新」→ 点芯片打开产品内更新对话框（进度条 + 安装并重启）

旧 N-1 安装包若没有更新条、也没有 Application 菜单「检查更新」，无法在 UI 里验证。

## Pitfalls

- 同版本重打会覆盖 `unsigned-artifacts` 里同名 exe，以及 `nightly.yml`。先上传 N 再打 N-1。
- `pnpm install` restore 会在 package 末尾跑；别中途清 `node_modules`。
- Node 必须 ≥26，不要用 Cursor helper `node.exe`。
- 密钥、SSH 密码、VPS 路径、本机盘符不入库、不回显。
