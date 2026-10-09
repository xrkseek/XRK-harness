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
- 用户说测自动更新、打低版本、服务器喂高版本、升 Desktop 补丁版
- 改 `XRK_DESKTOP_UPDATE_*`、`harness-download-Core`、Cloudflare 下载页 origin

## 产品内更新 UX（壳逻辑）

`DesktopUpdateCoordinator` + Settings `DesktopReleaseFooter`：

1. 发现新版本 → phase `available`，**立刻预下载**（进度条可动）。
2. 下载成功 → phase `ready`（percent 100）。
3. **「安装并重启」仅 `ready` 可点**；`available` / 下载中禁用。
4. 用户点安装 → phase `installing` → `quitAndInstall`。
5. 预下载失败 → phase `error`（勿在失败态仍开安装按钮）。

改这段行为后必须升 Desktop 壳版本再打包上传，旧安装包里没有新 UI 逻辑。

## 公开面（测试频道）

Origin（无尾斜杠）来自 `local.md` 或 `XRK_DESKTOP_UPDATE_TEST_ORIGIN`。路径：

| 用途 | 相对 origin |
|------|-------------|
| 目录 | `GET /releases` |
| 该平台最新安装包 | `GET /download/win-x64` |
| 更新 YAML | `GET /desktop/win-x64/nightly.yml`（另有 `latest.yml`） |
| exe / blockmap | `GET /desktop/bin/win-x64/<file>` |

`app-update.yml` generic `url` = origin + `/desktop/win-x64`。

Cloudflare 页：`apps/site`（`releases.json` 作 fallback；运行时优先拉 origin `/releases`）。安装包字节不走 CF。

AGT：`harness-download-Core`。监听 **0.0.0.0:6969**。目录扫描 `nightly.yml` → 公开 catalog；**无**单独 catalog.json 时以 yml 为准。

## 服务器落盘

```text
harness-download/
  desktop/win-x64/nightly.yml
  desktop/win-x64/latest.yml
  desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe
  desktop/bin/win-x64/*.blockmap
```

**公开文件名不要带 `unsigned`**（本机产物可带 `-unsigned`，上传前改名）。

## 本机 env

`apps/desktop/.env.windows`（gitignore）：

- `XRK_DESKTOP_UNSIGNED=1`
- `XRK_DESKTOP_UNSIGNED_UPDATE=1`（未签名包才写入更新源；壳内关 Authenticode 校验）
- `XRK_DESKTOP_AUTO_UPDATE_ENV=test`
- `XRK_DESKTOP_UPDATE_TEST_ORIGIN`（测试源 origin）
- upload dummy：`XRK_DESKTOP_UPLOAD_TEST_BUCKET` / `SECRET_ID` / `SECRET_KEY`

## 打包（NSIS + 非 ASCII 路径）

NSIS 不能往非 ASCII 路径写 exe。用临时盘符 `subst`（占用就换字母），cwd 仓库根、命令只含 ASCII。完成后 `subst <盘符>: /d`。产物可复制到用户桌面。

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

Cursor 锁住 `app.asar`（`EBUSY`）时设 `XRK_DESKTOP_UNSIGNED_ARTIFACTS_DIR=unsigned-artifacts-<ver>`。

## 发新版 · 标准流程（必按序）

版本 **N** 已写进 `apps/desktop/package.json`（并与 cli/sdk / `docs/releases/vN.md` 对齐）。

### A. 打包

1. `subst` 到 ASCII 盘符 → 上节 env → `pnpm package:desktop`
2. 判据：日志有 `package-complete-*.json`；exe 体积约 300MB+

### B. 本机 mirror（可选）

`XRK_DESKTOP_UNSIGNED=1 pnpm upload:desktop -- win-x64` → `upload-mirror/test/`  
（yml 里可能仍指向 `-unsigned` 文件名；上服务器前以 C 节为准改名。）

### C. 上服务器（改名 + **先 yml 后 exe**）

不要整目录盲传旧版大 exe。只推本版：

数据根（勿放错）：`/root/cs/XRK-AGT/data/harness-download/`（= AGT `paths.data` + `harness-download`）。  
公开 HTTPS：`https://xrk.siphot.com/api/harness/…`（openresty → `:6969`）。直连调试用 IP:6969。

1. 本地 stage：
   - `…/bin/win-x64/xrk-harness-N-win-x64.exe` ← 从 `*-unsigned.exe` **复制改名**
   - 同名 `.blockmap`
   - `nightly.yml` / `latest.yml`：`version: N`，`url`/`path` 用  
     **`https://xrk.siphot.com/api/harness/desktop/bin/win-x64/xrk-harness-N-win-x64.exe`**  
     （不要写裸 `http://IP:6969`，部分网络拦明文端口 → 更新下载失败）
2. **先传完整 exe + blockmap**（`stat` 大小 == 本地；`HEAD` Content-Length 对齐）
3. **再** 上传两个 yml（半截包 + 完整清单 → `sha512 checksum mismatch`）
4. 传断必须 `rm` 半截再重传
5. 核对：
   - `HEAD https://xrk.siphot.com/api/harness/desktop/bin/…/xrk-harness-N-win-x64.exe` → 200 + 完整长度
   - `GET …/releases` → `available:true`、version=N
   - `GET …/desktop/win-x64/nightly.yml` → `version: N` 且 url 为 HTTPS

SSH 命令与密码只在 `local.md` / 本机 mcp，**不入库、不回显**。

### D. 官网

- `apps/site/releases.json` 的 win-x64 `version`/`filename` 改为 N（仓库源码；**push 后会自动同步到 CF**，不必本机 `wrangler deploy`）
- Worker 演示文案里的版本号可顺手改
- 下载按钮运行时优先拉 origin `/releases`（AGT 已是 N 即可用）；`releases.json` 仅作 fallback

### E. 桌面副本（可选）

把改名后的 `xrk-harness-N-win-x64.exe` 拷到用户桌面。

**不要**把刚打的低版本测包再 upload，否则源会被降级。

## 测自动更新（N-1 → N）

1. 先按「发新版」把 **N** 推上服务器并确认 `nightly.yml`
2. `package.json` **临时**改成 **N-1** → 再 `package:desktop`（`UNSIGNED_UPDATE=1`）
3. **禁止** upload N-1
4. N-1 exe 拷桌面，`package.json` **改回 N**
5. 卸高版本 → 装 N-1 → 打开 → 底栏「有更新」→ 对话框：进度中安装按钮禁用 → 完成后可点 → 安装并重启到 N

## Pitfalls

- 先传整包 mirror 会先灌旧版几百 MB，yml 迟到——**先 yml 后本版 exe**。
- 半截 exe（传断）必须删掉再传；`HEAD` Content-Length 必须等于 yml `size`。
- 同版本重打覆盖同名产物与 `nightly.yml`。
- Node ≥26；不用 Cursor helper `node.exe`。
- 密钥、SSH 密码、VPS 路径、本机盘符不入库、不回显。
