---
name: xrk-desktop-update-feed
description: >-
  Desktop 未签名打包、upload-stage 改名、electron-updater / AGT harness-download
  上传与核对。package:desktop、上测试更新源、测自动更新时使用。
  整条发版顺序见 rule xrk-release-flow；npm/GH 副作用见 xrk-release-chain。
---

# Desktop 打包与 AGT 更新源

## 职责边界（勿与其它文打架）

| 载体 | 只管 |
|------|------|
| rule `xrk-release-flow` | 整条发版**顺序**与硬禁 |
| skill `xrk-release-chain` | npm / GH / stage 掏空根 deps 等**副作用** |
| **本 skill** | Desktop **怎么打**、**怎么 stage**、**怎么上 AGT**、**怎么核** |
| rule/skill `xrk-local-artifacts` | 落点 / ≤5 / subst |
| skill `xrk-github-npm-net` | 直连 vs `127.0.0.1:7897` 选路（**先探再选**） |

机相关 origin / SSH：同目录 **`local.md`**（gitignore）。缺则 env `XRK_DESKTOP_UPDATE_TEST_ORIGIN`。

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

### 体积判据（0.7.5）

- `electron` / `electron-builder` **只在** Desktop `devDependencies`；运行时依赖仅 `electron-updater`。
- 打完后 `app.asar.unpacked` **不得**含完整 `electron/dist`（曾嵌套一整份 Electron → exe ~330MB）。
- 正常 exe 约 **190–230MB** 量级（对照上一正式版）。
- **别拿体积差值当进包判据**（0.7.8 实锤）：新增依赖是否进包，只认解包硬证据——`win-unpacked/resources/host/node_modules/<pkg>` 存在 + 关键导出 `require(...)=function`。NSIS LZMA 对 DLL 压缩比高：sherpa-onnx-win-x64 原始 23,161,917 B，exe 净增仅 +5.56MB。
- electron 二进制下载走 electron-builder 内置 got，**不读命令行代理参数、只认 env**。GitHub 直连本轮不通时（0.7.8：direct=000 / proxy=200 反转），破例允许 `cmd /c "set HTTPS_PROXY=…&& set ELECTRON_GET_USE_PROXY=1&& …"` **单命令级内联**——绝不落 Host 会话环境。

## 公开更新源布局

Origin 例（见 `local.md`）：`http://<host>:6969/api/harness`（**无尾斜杠**；**要带端口**）。

| 用途 | URL 后缀 |
|------|----------|
| 目录 | `GET /releases` |
| YAML | `GET /desktop/win-x64/nightly.yml`（及 `latest.yml`） |
| 字节 | `GET /desktop/bin/win-x64/<file>` |
| 下载入口 | `GET /download/win-x64` |

盘上：

```text
harness-download/
  desktop/win-x64/nightly.yml
  desktop/win-x64/latest.yml
  desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe
  desktop/bin/win-x64/*.blockmap
```

## Stage 改名（上 AGT 前）

`upload-stage-<ver>/`：

```text
desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe          # 去掉 unsigned
desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe.blockmap
desktop/win-x64/nightly.yml
desktop/win-x64/latest.yml                                 # 与 nightly 同内容
```

### yml 硬规则（0.7.5 踩过）

electron-builder 写出的 `nightly.yml` 常是**相对**文件名。相对 URL 会相对 **feed 目录**  
`…/desktop/win-x64/` 解析 → 去找 `…/desktop/win-x64/<exe>` → **404**。

**必须**把 `url` / `path` 写成 **绝对 URL**，且指向 **bin**：

```yaml
version: <ver>
files:
  - url: http://<host>:6969/api/harness/desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe
    sha512: <base64>
    size: <bytes>
path: http://<host>:6969/api/harness/desktop/bin/win-x64/xrk-harness-<ver>-win-x64.exe
sha512: <base64>
releaseDate: '…'
```

- 公开名**不带** `unsigned`
- `sha512` 为 **base64**（`Get-FileHash` 是 hex，要换算）
- 仓内 `desktop-upload-plan` 也会把 mirror yml 改成绝对 URL；手写 stage 时同样遵守

## 上传

助手脚本：`scripts/_upload-desktop-agt.py`（读 `local.md` 侧 `.agt-password` 或 `XRK_AGT_SSH_PASSWORD`）。

顺序（不可颠倒）：

1. 完整 **exe + blockmap** → `desktop/bin/win-x64/`
2. 再传 **nightly.yml + latest.yml** → `desktop/win-x64/`

半截包必须删后再传。SSH 不通时先探（见 `xrk-github-npm-net`）；**不要**设全局 `HTTPS_PROXY`。

## 核对清单

```text
1. GET  …/desktop/win-x64/nightly.yml     → version = N，url 为绝对 bin 路径
2. HEAD …/desktop/bin/win-x64/<exe>       → Content-Length == 本地 exe == yml size
3. SFTP/stat 远端 exe size == 本地（防半截上传；releases.bytes 只反映 yml，不可替代）
4. GET  …/releases                        → win-x64.version = N，available=true
5. （可选）本机算 sha512 base64 == yml
```

错误示例（已踩）：

- 客户端 `Cannot download 'http://…/desktop/win-x64/xrk-harness-….exe' 404`  
  → yml **相对**路径（解析到 feed 目录，不是 `bin/`）
- `HEAD`/`stat` size ≪ 本地（如 ~60MB vs ~193MB）  
  → **半截上传**；必须重传完整 exe 后再传 yml

## 发新版（桌面段）

1. **GH Release / 本地 tgz 已在且根 `devDeps` 已装回 → 立刻打包**（不要等 CLI `npm view` 转绿；见 `xrk-release-chain` 0.7.20）  
2. 打包 + 体积判据通过（`C:\xrk-h`）  
3. Stage 改名到 `upload-stage-<ver>/` + **绝对 URL yml**（公开名去 `unsigned`）  
4. 上 AGT：`XRK_DESKTOP_UPLOAD_STAGE=<该目录> python scripts/_upload-desktop-agt.py`（exe+blockmap → yml）+ 核对清单  
   - `pnpm upload:desktop -- win-x64` **仅本机 mirror**，不能代替本步  
5. **同时** `gh release upload v<ver> <公开名.exe> --clobber`（Worker 首选 GH asset）  
6. **然后**改 `apps/site/releases.json` → commit + **push main**（Worker **跟 GitHub**，CF 连仓自动部署；**禁止**手跑 wrangler / 追 CF token）  
7. 手测副本 → `.release/desktop/<ver>/`；**再复制一份** `xrk-harness-<ver>-win-x64.exe` 到用户桌面（方便转发朋友）  
8. `pnpm prune:local`  
9. **禁止**把测更新用的 N-1 包 upload 到源  

### 今日踩坑（0.7.20）

| 症状 | 根因 | 以后 |
|------|------|------|
| 卡在 CLI `FETCH_ERROR` / `npm view` 404 不打桌面 | 把 registry validate 当成 Desktop 前置 | GH+本地 tgz 齐 → **先** `package:desktop` |
| `upload:desktop -- --target win-x64` 炸 | 只有位置参数 `win-x64` | `pnpm upload:desktop -- win-x64`；真 AGT 用 `_upload-desktop-agt.py` |
| 以为官网要手 deploy Worker | 误判「import releases.json ⇒ 本地 wrangler」 | **push main 即够**；Worker 跟 GitHub |

## 测自动更新（N-1 → N）

1. 源上已是 N  
2. 临时包 N-1 → **不 upload**  
3. 装 N-1 → 预下载 → 仅 `ready` 可「安装并重启」→ 升到 N  
4. 改回 N；`pnpm prune:local`

## 相关

教科书：[docs/publishing.md](../../../docs/publishing.md)。  
rule：`xrk-release-flow` · `xrk-local-artifacts`。  
skill：`xrk-release-chain` · `xrk-github-npm-net`。
