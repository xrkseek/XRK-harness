---
name: xrk-dev-surfaces
description: >-
  XRK 三生态（CLI · Desktop · Mobile）固定开发/打包/隔离验收总控：前台可见命令、
  隔离 home、禁止试错循环。发版/打 APK（真机）/本机 Host 手测/桌面测包前先读。
  **禁止 MuMu 手测**（模拟器无 arm proot）。细节叶：xrk-release-chain · xrk-desktop-update-feed · xrk-mobile-apk · xrk-local-artifacts。
---

# 三生态 · 开发者即用户（固定流程）

- **Status:** Accepted
- **Date:** 2026-11-09
- **Tags:** cli, desktop, mobile, packaging, isolation, foreground
- **Related:** rule `xrk-release-flow` · `xrk-local-artifacts` · `xrk-mobile-apk` · knowledge-map

> **本篇是路由 + 铁律，不是把各叶技能正文再抄一遍。**  
> 懵的时候先打开本篇选「面」，再跳到对应叶技能执行；禁止在对话里逐步试 `flutter` / `subst` / `npm publish`。

## 何时用

- 用户说「打 APP / 真机装 / 打包桌面 / 发版 / 本机测 Host / smoke」
- Agent 又要猜 ABI、猜产物路径、后台偷偷跑长任务
- 准备同时动 CLI / Desktop / Mobile，怕污染日用 `~/.xrk`

## 铁律（所有面共用）

1. **前台可见**：长打包 / 发版 / APK / Desktop package **必须**在用户能看见的终端前台跑（Shell **不要** `block_until_ms: 0` 丢后台假装完成；失败要立刻停并打印下一跳）。
2. **禁止试错循环**：缺门禁就改脚本加门禁；不要在对话里换 4 种路径试 Flutter / subst。
3. **日用 home 隔离**：手测 **禁止**写正在用的 `~/.xrk`（真源 rule/skill `xrk-local-artifacts`）。
4. **禁止并行打包**：`release:stage` / `pnpm release` **不得**与 `package:desktop` / 手机 `build-apk` 并行（rule `xrk-release-flow`）。
5. **Node ≥26**：跑 `pnpm` / 门禁前先把系统 Node 插到 PATH 最前（rule `xrk-node26`）；禁用 Cursor helper Node 22。
6. **壳 ≠ 引擎**：改 `packages/client` 的对话 UI ≠ 自动进手机 APK；手机对话 UI 在 **guest xrkh** 里。

## 三面地图

| 面 | 仓 / 入口 | 用户看到什么 | 隔离 home | 产物落点 | 叶技能 |
|----|-----------|--------------|-----------|----------|--------|
| **CLI / Host / Web** | 本仓 `apps/cli` · `apps/web` · `packages/*` | `xrkh web\|serve` 浏览器壳 | `XRK_HOME=%USERPROFILE%\.xrk-smoke` | 源码树；发版 tgz → `.release/` | `xrk-local-artifacts` · `xrk-release-chain` |
| **Desktop** | 本仓 `apps/desktop` · `apps/desktop-host` | 安装包 / 开发投影窗 | `apps/desktop/.desktop-build/development/home` | `.desktop-build/targets/…` · `.release/desktop/<ver>/` | `xrk-desktop-update-feed` · `xrk-release-flow` |
| **Mobile** | 旁仓 `XRK-harness-mobile`（中文路径） | APK 壳 + 机内 proot xrkh | 机内 app files；本机构建树 `C:\xrk-mobile` | `C:\xrk-mobile\out\*.apk` | `xrk-mobile-apk` · mobile `docs/HANDOFF.md`（phone_* · 技能 merge · 发行命名） |

仓库根：`C:\Users\xrkseek\Desktop\主仓库\XRK-harness`  
手机仓：`C:\Users\xrkseek\Desktop\主仓库\XRK-harness-mobile`

---

## 面 A · CLI / Web Host（本机当用户）

### 固定命令（前台）

```powershell
# 1) 系统 Node ≥26 置前（rule xrk-node26）
$pick = @(where.exe node 2>$null) | Where-Object { $_ -notmatch '\\cursor\\resources\\app\\resources\\helpers\\node\.exe$' } | Select-Object -First 1
$env:Path = "$(Split-Path -Parent $pick);$env:Path"
node -v

# 2) 隔离 home
$env:XRK_HOME = "$env:USERPROFILE\.xrk-smoke"
New-Item -ItemType Directory -Force -Path $env:XRK_HOME | Out-Null

# 3) 需要新壳时再编（有 dist 可跳过）
pnpm build
pnpm web:build; pnpm client:bundle; pnpm web:assemble

# 4) 起 Host（用户浏览器打开打印的 URL）
node apps/cli/dist/bin.js web
# 或: node apps/cli/dist/bin.js serve
```

### 门禁

```powershell
pnpm check   # 改契约后必跑；前台
```

### 不要做

- 不要用日用 `~/.xrk` 跑 smoke
- 不要把手机 Flutter 构建混进本仓 Desktop `subst X:` / `C:\xrk-h`

---

## 面 B · Desktop（本机当用户）

### 日常开发（隔离）

```powershell
# development home 已由 Desktop 投影使用；不要指到 ~/.xrk
pnpm build:desktop   # 或文档中的 dev:desktop
pnpm start:desktop   # 以本仓脚本为准
```

### 打测包 / 上 AGT / 发版

**只走** rule `xrk-release-flow` + skill `xrk-desktop-update-feed` + `xrk-release-chain`：

1. bump · 发行说明 · `pnpm check` · **commit + push main**
2. `pnpm release:stage` (+ sdk) → `CI=true pnpm install --frozen-lockfile`
3. `pnpm release` → 再 `CI=true pnpm install --frozen-lockfile`
4. **立刻**打安装包（**不要**等 CLI npm validate）：Desktop @ `C:\xrk-h`；APK 可**并行**（面 C / `ENGINE_TGZ`）——二者都**禁止**与步骤 2/3 并行
5. AGT 上传（`_upload-desktop-agt.py`）+ `gh release upload` exe
6. **安卓发行版**（同号必做）：手机仓 bump → 重打 APK → `release_assets.py` → `gh release create` @ `XRK-harness-mobile`（本机 out APK **不算**发行）
7. 改 `apps/site/releases.json`（**win-x64 + android-arm64**）→ **push main**（Worker 跟 GitHub，勿手 wrangler）
8. `pnpm prune:local -- --junk`

网络选路：`xrk-github-npm-net`（先探再选；禁全局 `HTTPS_PROXY`）。

---

## 面 C · Mobile（本机当用户 · 真机）

### 产品真源（来自 dsh-go / 本仓 HANDOFF，不是猜）

| 步骤 | 命令 / 落点 | 说明 |
|------|-------------|------|
| 0.（可选）本地 Host | `xrk-mobile-apk/scripts/pack-local-engine.ps1` → `.release/mobile-engine/*.tgz` | **不必 commit / 不必 npm publish**；AGT 用 `ENGINE_TGZ=` |
| 1. 编 guest runtime | Linux（AGT）：`runtime/build-runtime.sh arm64-v8a`（可加 `ENGINE_TGZ`） | 产出 `…/out/arm64-v8a/{assets/runtime,jniLibs}` |
| 2. 拉回本机 | AGT `/root/xrk-mobile/out/arm64-v8a` → 手机仓 `runtime/out/arm64-v8a` | Gradle `sourceSets.arm64` **只读**这里 |
| 3. 门禁 | `manifest.json` + `rootfs-arm64-v8a.tar.xz`（约 ≥80 MB）必须存在 | **缺则禁止** `build-apk` |
| 4. 打 APK | ASCII 树 `C:\xrk-mobile` + `tooling/build-apk.sh`（默认 **arm64**） | 禁止中文路径直编；禁 subst/junction |
| 5. 真机安装（可选） | `adb install -r C:\xrk-mobile\out\…arm64-release.apk` | **禁止 MuMu**；包名 `com.xrkseek.harness` |

**一键打 APK（前台，默认不出模拟器）**：

```powershell
pwsh -File "C:\Users\xrkseek\Desktop\主仓库\XRK-harness\.agents\skills\xrk-mobile-apk\scripts\build-install-mumu.ps1"
# 真机再：adb install -r C:\xrk-mobile\out\xrk-harness-*-arm64-release.apk
```

**本仓 Host 也要进机内（可未提交）**：先 `pack-local-engine.ps1` → scp tgz → AGT `ENGINE_TGZ=… ENGINE_VERSION=… build-runtime.sh` → 拉回 `runtime/out` → 再跑上面一键。细节见 `xrk-mobile-apk`「本地源码 xrkh」。

脚本必须：拷贝 → **检查 `runtime/out/arm64-v8a`** → `build-apk.sh` → 出 APK。缺 runtime 立即失败并打印 AGT 拉回步骤。**不要**为 MuMu 装包。

### ABI 纪律

- **产品手测固定 arm64 真机**。  
- **禁止 MuMu / 模拟器验收**（跑不了 arm proot 虚拟终端）。  
- x64 仅显式 `-Flavor x64` 且已有 `runtime/out/x86_64` 时的专项，不是模拟器替代路径。

### 「安装未完成 / manifest:」

| 症状 | 根因 | 处置 |
|------|------|------|
| `App 内的运行环境包不完整` | APK 未打入 `assets/runtime`（`runtime/out/<abi>` 空或缺） | 先补齐 `runtime/out/arm64-v8a`，再重打；**禁止**空壳 APK 当完成 |
| 开屏仍写 DSH Go | l10n `parts/*.arb` 未换 + BrandMark 仍是鱼尾 | 改 parts → `l10n_merge.py`；标换成 XRK logo |
| 对话插队 / Settings 模型目录旧 | 改的是 harness `packages/*`，机内仍是 npm 旧 cli | **ENGINE_TGZ** 重编 runtime 再打 APK；只重打壳不够 |

AGT（runtime 构建机）：见手机仓 `docs/HANDOFF.md` §1.3（`103.236.89.174:46184`，工作目录 `/root/xrk-mobile`）。密码文件只在 `xrk-desktop-update-feed/.agt-password`（勿写入 skill 正文）。

---

## 决策树（Agent 入口）

```
用户要什么？
├─ 发版 / npm / GH / 桌面上 AGT     → xrk-release-flow → release-chain → desktop-update-feed
├─ 只打桌面测包 / 测更新            → desktop-update-feed · local-artifacts
├─ 打手机 APK / 真机                → 本篇面 C → xrk-mobile-apk 一键脚本（禁 MuMu）
├─ 本仓 Host 未发版也要进手机       → pack-local-engine.ps1 → ENGINE_TGZ → 面 C
├─ 本机当用户测 Host/Web            → 本篇面 A（XRK_HOME=.xrk-smoke）
├─ 本机当用户测 Desktop 开发投影    → 本篇面 B development home
└─ 改对话 UI 且要手机看见           → pack-local-engine + ENGINE_TGZ 重编 guest，再打壳
```

## 冗余与以后删什么

| 冗余 | 处置 |
|------|------|
| 对话里逐步试 Flutter / subst / junction | **删流程**：只保留一键脚本；失败改脚本 |
| home 副本旧 skill（`~/.xrk/skills/xrk-*`） | 以仓库 `.agents/skills` 为准；勿改 home |
| 空壳 APK（无 `assets/runtime`）当「打完了」 | 门禁拒绝 |
| 装 MuMu 当手测 | **禁止**；模拟器无 arm proot |
| 把本篇正文抄进 MEMORY.md | 禁止；knowledge-map 只留路由 |

## 今晚质量清单（执行时勾）

- [ ] Mobile：`runtime/out/arm64-v8a` = AGT r17-xrk（完整 rootfs），`build-install-mumu.ps1` 有 runtime 体积门禁  
- [ ] Mobile：开屏文案 / BrandMark 去 DSH；风格对齐 Web 深色  
- [ ] CLI：`.xrk-smoke` 起 `xrkh web` 能当用户走完首轮  
- [ ] Desktop：development home 起一次，不碰 `~/.xrk`  
- [ ] 发版链路：不在本会话并行 stage + package:desktop  

## 相关

- 索引：`.agents/skills/xrk-harness-knowledge-map`  
- Coding 索引：`.cursor/skills/SKILL_INDEX.md`  
- 手机操作细节：`.agents/skills/xrk-mobile-apk`  
- 手机仓真源：`XRK-harness-mobile/README.md`「从源码构建」· `docs/architecture.md`「打包」· `docs/HANDOFF.md`
