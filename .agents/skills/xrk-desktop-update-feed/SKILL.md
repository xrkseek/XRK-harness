---
name: xrk-desktop-update-feed
description: >-
  XRK-Harness Desktop 未签名测包、electron-updater 测试源、AGT harness-download
  落盘路径与发新版必上传。测自动更新（本机低版本装、服务器高版本喂）、
  package:desktop / upload:desktop、把 exe 放到桌面、SSH 同步 VPS 时使用。
---

# Desktop 测试更新源（AGT）

发 **新桌面版必须上服务器更新源**。只打本机 exe、不 PUT 到 AGT，装旧版的人拉不到更新。

## When to Use

- `pnpm package:desktop` / `pnpm upload:desktop` / 桌面包放到桌面
- 用户说测自动更新、打低版本、服务器喂高版本
- 改 `XRK_DESKTOP_UPDATE_*`、`harness-download-Core`、Cloudflare 下载页 origin

## 公开面（测试频道）

Origin（无尾斜杠）：`http://103.236.89.174:6969/api/harness`

| 用途 | URL |
|------|-----|
| 目录 | `GET /api/harness/releases` |
| 该平台最新安装包 | `GET /api/harness/download/win-x64` |
| 更新 YAML | `GET /api/harness/desktop/win-x64/nightly.yml`（另有 `latest.yml`） |
| exe / blockmap | `GET /api/harness/desktop/bin/win-x64/<file>` |

`app-update.yml` generic `url` = origin + `/desktop/win-x64`。

Cloudflare 页：`apps/site`（`downloadOrigin` 同上）。字节不走 CF。

AGT：`harness-download-Core`（本地源码仓旁 `XRK-AGT/core/harness-download-Core/`）。监听 **0.0.0.0:6969**。改 Core 后 `pnpm build` 并重启 AGT。

## 服务器落盘

VPS 仓库：`/root/cs/XRK-AGT`  
数据根：`/root/cs/XRK-AGT/data/harness-download/`（Core `paths.data/harness-download`）

与本机 `apps/desktop/.desktop-build/upload-mirror/test/` **同构**：

```text
data/harness-download/
  desktop/win-x64/nightly.yml
  desktop/win-x64/latest.yml
  desktop/bin/win-x64/xrk-harness-<ver>-win-x64-unsigned.exe
  desktop/bin/win-x64/*.blockmap
```

SSH 同步（密码只在本机 `~/.cursor/mcp.json`，**禁止**写进 skill / git / 回复）：

```text
python %USERPROFILE%\.cursor\xrk-ssh-put-dir.py <ascii-local-mirror> /root/cs/XRK-AGT/data/harness-download
```

`<ascii-local-mirror>` 用 subst 盘符下的 `apps/desktop/.desktop-build/upload-mirror/test`，不要把中文 `主仓库` 写进 PowerShell 字面量。

## 本机 env

`apps/desktop/.env.windows`（gitignore）：

- `XRK_DESKTOP_UNSIGNED=1`
- `XRK_DESKTOP_UNSIGNED_UPDATE=1`（未签名包才写入更新源；否则 updater 不检查）
- `XRK_DESKTOP_AUTO_UPDATE_ENV=test`
- `XRK_DESKTOP_UPDATE_TEST_ORIGIN=http://103.236.89.174:6969/api/harness`
- upload dummy：`XRK_DESKTOP_UPLOAD_TEST_BUCKET` / `SECRET_ID` / `SECRET_KEY`（本机 filesystem mirror 仍要求这三项有值）

## 打包（NSIS + 中文路径）

仓库在 `...\Desktop\主仓库\XRK-harness`。NSIS 不能往非 ASCII 路径写 exe。

**不要** `mklink /J C:\xrk-h`（资源管理器会在 C 盘根展开整棵仓）。用临时盘符：

```text
# cwd = 仓库根（工具 working_directory），命令里只有 ASCII
subst X: .
# 完成后
subst X: /d
```

`X:` 占用就换字母。产物复制到 `%USERPROFILE%\Desktop\`，不要在 `C:\` 另建 `xrk-install` 一类残留目录。

从 `X:\`：

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

## 发新版（必上传）

1. `apps/desktop/package.json` 已是要发布的版本 **N**
2. `pnpm package:desktop`（上节）
3. `XRK_DESKTOP_UNSIGNED=1 pnpm upload:desktop -- win-x64` → 写本机 mirror
4. `xrk-ssh-put-dir.py` 把 `upload-mirror/test` 同步到 `/root/cs/XRK-AGT/data/harness-download`
5. `GET .../desktop/win-x64/nightly.yml` 的 `version:` 必须是 **N**（先于本机安装包）
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
- 密钥、SSH 密码不入库、不回显。
