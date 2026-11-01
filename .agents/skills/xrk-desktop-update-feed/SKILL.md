---
name: xrk-desktop-update-feed
description: >-
  Desktop 未签名打包、固定本机落点、≤5 版本地备份、electron-updater 测试源、
  AGT harness-download 上传顺序。package:desktop / upload:desktop / 测自动更新时使用。
---

# Desktop 打包与测试更新源

机相关 origin / VPS / SSH：同目录 **`local.md`**（gitignore）。缺则只认 env `XRK_DESKTOP_UPDATE_TEST_ORIGIN`。

## 本机落点（唯一约定）

| 用途 | 路径 |
|------|------|
| 当前未签名产物（覆盖写） | `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/` |
| 版本快照（≤5） | 同级 `unsigned-artifacts-<ver>/`（仅 EBUSY 或显式归档时） |
| 上传 stage（≤5） | `…/targets/win-x64/upload-stage-<ver>/` 或 `.desktop-build/upload-stage-<ver>/` |
| npm stage / tgz（≤5） | `.release/xrkseek-harness(-cli)-<ver>.tgz` · `.release/harness` · `.release/harness-cli` |
| 手测 exe 归档（≤5） | `.release/desktop/<ver>/xrk-harness-<ver>-win-x64.exe` |
| 开发壳隔离 home | `apps/desktop/.desktop-build/development/home`（≠ `~/.xrk`） |

**禁止**：把安装包散落用户桌面根目录；在 `.release/` 堆一次性脚本/日志；新建随机 `subst` 盘符且不拆除。

裁剪：`pnpm prune:local`（默认 `--keep 5`）；一次性垃圾加 `--junk`。当前工作槽：`pnpm clean:desktop`。

## Windows 路径（NSIS）

NSIS 不能向含非 ASCII 的路径写 exe。

1. **优先**：本机已有 ASCII 结 **`C:\xrk-h`** → 本仓时，在该路径跑打包（`cd /d C:\xrk-h`）。**不要**在 `C:\` 再造 `xrk-h-upload-*`。
2. **仅当没有结时**：`subst X: <仓库根>`，cwd=`X:\`，打包结束后 **`subst X: /d`**（失败也拆）。字母固定 **`X:`**；禁止改用 Y/Z 后残留。
3. 开跑前 `subst` 自检；结束后再查，不得残留。上传 stage / 手测 exe 只进 `.desktop-build` 与 `.release`（见 rule `xrk-local-artifacts`）。

```text
XRK_DESKTOP_PACKAGE=1
XRK_DESKTOP_UNSIGNED=1
XRK_DESKTOP_UNSIGNED_UPDATE=1
XRK_DESKTOP_TARGET=win-x64
CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm package:desktop
```

未设 `XRK_DESKTOP_PACKAGE=1` 只写 plan。判据：`package-complete-*.json` + exe 体积正常。

Cursor 锁 `app.asar`（`EBUSY`）时：`XRK_DESKTOP_UNSIGNED_ARTIFACTS_DIR=unsigned-artifacts-<ver>`，打完 `pnpm prune:local`。

产物文件名：`xrk-harness-<ver>-win-x64-unsigned.exe` + `.blockmap` + `nightly.yml`。

## 公开更新源

Origin：`local.md` 或 `XRK_DESKTOP_UPDATE_TEST_ORIGIN`（无尾斜杠）。

| 用途 | 路径 |
|------|------|
| 目录 | `GET /releases` |
| 安装包 | `GET /download/win-x64` |
| YAML | `GET /desktop/win-x64/nightly.yml`（另有 `latest.yml`） |
| 字节 | `GET /desktop/bin/win-x64/<file>` |

服务器数据根：`…/data/harness-download/`（AGT `harness-download-Core`，`:6969`）。

```text
harness-download/
  desktop/win-x64/nightly.yml
  desktop/win-x64/latest.yml
  desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe
  desktop/bin/win-x64/*.blockmap
```

公开文件名**不带** `unsigned`。上传：**先完整 exe+blockmap，再 yml**。半截包必须删后再传。

## 发新版顺序

版本 N 已写入 `apps/desktop/package.json`（与 cli/sdk、`docs/releases/vN.md` 对齐）。

1. 按上节打包 → 判据通过。
2. （可选）`XRK_DESKTOP_UNSIGNED=1 pnpm upload:desktop -- win-x64` → 本机 mirror。
3. Stage 改名后的 exe/blockmap/yml → 推 AGT；yml 内 URL 用 `local.md` 的明文 origin。
4. `HEAD` 长度对齐；`/releases` 与 `nightly.yml` 版本 = N。
5. 更新 `apps/site/releases.json` win-x64 字段后 push（CF 同步）。
6. 手测副本只进 `.release/desktop/<ver>/`，然后 `pnpm prune:local`。
7. **禁止**把测更新用的 N-1 包 upload 到源。

## 测自动更新（N-1 → N）

1. 源上已是 N。
2. 临时把 `package.json` 改成 N-1 → 打包 → **不 upload**。
3. 装 N-1 → 验证预下载与「安装并重启」仅 `ready` 可点 → 升到 N。
4. 改回 N；`pnpm prune:local`。

## 壳内更新 UX

`DesktopUpdateCoordinator`：`available` 即预下载 → `ready` 才可「安装并重启」→ `quitAndInstall`。改 UX 须升壳版本再打包上传。

## 本机 env

`apps/desktop/.env.windows`（gitignore）：`XRK_DESKTOP_UNSIGNED*` · `XRK_DESKTOP_AUTO_UPDATE_ENV=test` · `XRK_DESKTOP_UPDATE_TEST_ORIGIN` · upload dummy 桶密钥。

## 相关

教科书：[docs/publishing.md](../../../docs/publishing.md)「本机产物」。  
红线 rule / skill：`.cursor` **`xrk-local-artifacts`**。发包链：`xrk-release-chain`。门禁 / 隔离 home：[docs/testing.md](../../../docs/testing.md) §10。
