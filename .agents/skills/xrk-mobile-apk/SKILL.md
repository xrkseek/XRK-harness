---
name: xrk-mobile-apk
description: >-
  XRK-harness-mobile：ASCII 路径打 arm64 APK、runtime/out 门禁、壳与机内 xrkh 分层。
  本地未提交 harness-cli 可经 ENGINE_TGZ 打进 guest runtime（不必 npm publish / 不必 commit）。
  打手机包 / 真机 adb /「为什么这次 UI 改动没进 APK」时使用。
  **禁止 MuMu 手测**（模拟器跑不了 arm proot 虚拟终端）。
  禁止在中文路径上直接 flutter build；禁止用 subst 盘符编 Flutter；缺 runtime 禁止出包。
  总控流程见 xrk-dev-surfaces 面 C。
---

# 手机 APK（XRK-harness-mobile）· 打包与真机

## 职责边界

| 载体 | 只管 |
|------|------|
| **总控** | `.agents/skills/xrk-dev-surfaces`（三生态选路、前台、隔离） |
| **本 skill** | 怎么打 APK、runtime 门禁、本地 xrkh 进 guest、真机安装、壳 ≠ 机内 xrkh |
| rule `xrk-mobile-apk` | Agent 红线 |
| rule/skill `xrk-local-artifacts` | 本机产物落点总表 |
| mobile `tooling/build-apk.sh` | Flutter 真源构建脚本 |
| mobile `runtime/build-runtime.sh` | guest rootfs；支持 `ENGINE_TGZ=` |
| **本 skill `scripts/pack-local-engine.ps1`** | 本机打 harness-cli tgz（可未提交） |
| **本 skill `scripts/agt-rebuild-runtime.py`** | 上传 tgz → AGT 编 arm64 → 打印 `STATUS=RUNNING` / **`DONE_OK`** / `DONE_FAIL`（禁糊 pgrep） |
| **本 skill `scripts/agt-pull-runtime.py`** | 拉回 `runtime/out`；终态 **`STATUS=DONE_OK`** |
| **本 skill `scripts/build-install-mumu.ps1`** | **一键打 APK**（默认 **-SkipInstall**；脚本名遗留，**不**再默认装 MuMu） |

本仓工作区根：`C:\Users\xrkseek\Desktop\主仓库\XRK-harness`  
手机仓：`C:\Users\xrkseek\Desktop\主仓库\XRK-harness-mobile`（路径含**中文**，不可直接 `flutter build`）

## 手测纪律（2026-11-10）

| 允许 | 禁止 |
|------|------|
| **真机 arm64** `adb install -r` | **MuMu / 任意模拟器**当产品验收 |
| 只打 APK 交付（`-SkipInstall`） | 为「装进 MuMu」浪费时间 / 改打 x64 |

原因：MuMu 等模拟器**跑不了**机内 arm proot 虚拟终端（guest xrkh）。产品手测只认真机。

## 两层产品（必须先分清）

| 层 | 是什么 | 改哪里 | 进 APK？ |
|----|--------|--------|----------|
| **Flutter 壳** | 启动页 + WebView / 原生引导 | `XRK-harness-mobile/app/` | **是**（只重打壳即可） |
| **机内 xrkh** | proot 里的 harness-cli + Web 壳 | 本仓 `packages/*` · `apps/cli` · `apps/web` | **经 `runtime/out/<abi>`**（要重编 guest） |

只重打壳、不更新 `runtime/out` → 对话 UI / Host / Settings 模型目录仍是旧的。

## 手机独属技能 / 工具（继承给未来 Agent）

**不改 establish 底层。** 通用种子与手机独属源分目录；手机 runtime 构建时再放进同一 `seeds/skills/`：

| 要挂什么 | 落点 | 禁止 |
|----------|------|------|
| `xrk-phone` 等 playbook | 源：`apps/cli/seeds/mobile/skills/` → `build-runtime.sh` merge → guest `seeds/skills/` → 普通 fingerprint establish | 直接写进通用 `seeds/skills/` · 全席 `AGENTS.md` · establish 里加 `XRK_MOBILE_*` 分支 |
| `xrk-guide` / `xrk-ui`（App 壳 HOWTO） | Flutter `assets/skills/` managed install | 塞进 CLI 全席种子 |
| `phone_*` 工具 | PhoneGuest → guest `{XRK_HOME}/plugins/xrk-mobile` | 写进 Desktop 默认插件 |

细则：`apps/cli/seeds/mobile/README.md` · `xrk-inject-layer`「Mobile-only」· 手机仓 `docs/HANDOFF.md`。  
**门禁**：`pnpm release:stage` / `pack-local-engine.ps1` 缺 `seeds/mobile/skills/xrk-phone` 即失败；AGT `merge_mobile_skill_seeds` 缺目录亦失败（禁止 silent skip）。

## 产品 ABI

| Flavor | Gradle 读 | 用途 |
|--------|-----------|------|
| **arm64（默认）** | `runtime/out/arm64-v8a/` | **真机**产品手测 |
| x64 | `runtime/out/x86_64/` | 仅显式 `-Flavor x64`（专项；**不是** MuMu 替代路径） |

真源：mobile `docs/architecture.md`「打包」· `README.md`「从源码构建」· AGT 编 runtime（见本 skill「本地源码 xrkh」）。

---

## 本地源码 xrkh（不必 commit / 不必 npm publish）

默认 `build-runtime.sh` 从 **npmjs** 装 `@xrkseek/harness-cli@$ENGINE_VERSION`。未发版的本仓改动**不会**进 APK，除非走本地 tgz：

| 步骤 | 命令 / 落点 |
|------|-------------|
| 1. 本机打 tgz | `pwsh -File .agents/skills/xrk-mobile-apk/scripts/pack-local-engine.ps1` → `.release/mobile-engine/xrkseek-harness-cli-<ver>.tgz` |
| 2–3. 上传 + AGT 编 | `python .agents/skills/xrk-mobile-apk/scripts/agt-rebuild-runtime.py`（读 `.agt-password`；stdout 必有 **`STATUS=DONE_OK`** 才算完；`--status-only` 只查） |
| 4. 拉回 | `python .agents/skills/xrk-mobile-apk/scripts/agt-pull-runtime.py` → 手机仓 `runtime/out/arm64-v8a/`（**`STATUS=DONE_OK`**） |
| 5. 打 APK | `scripts/build-install-mumu.ps1`（默认只出包；真机再 `adb install -r`） |

终态约定：AGT / 拉回脚本只认一行 **`STATUS=DONE_OK`**（失败 `DONE_FAIL` / 超时 `TIMEOUT`）。旧 `.release/agt-start-runtime-build.py` 会因 `pgrep` 自匹配卡在 `ALIVE`——**不要再用**。

**壳-only**（只动 Flutter / l10n / BrandMark）：跳过 1–4，直接步骤 5（须已有完整 `runtime/out/arm64-v8a`）。

**Host / Web / brands 改动**：必须 1–5；否则机内仍是 npm 上的旧 cli。

`ENGINE_TGZ` 真源：`XRK-harness-mobile/runtime/build-runtime.sh`（`install_engine`）。

---

## 完整链路（禁止跳步）

### A · 仅壳（runtime 已齐）

```powershell
pwsh -File "C:\Users\xrkseek\Desktop\主仓库\XRK-harness\.agents\skills\xrk-mobile-apk\scripts\build-install-mumu.ps1"
# 默认 -SkipInstall；真机：adb install -r C:\xrk-mobile\out\xrk-harness-*-arm64-release.apk
```

### B · 本仓 Host 也要新（可未提交）

1. `pack-local-engine.ps1`（前台）
2. `agt-rebuild-runtime.py` → 等到 **`STATUS=DONE_OK`**（含 merge `xrk-phone`）
3. `agt-pull-runtime.py` → **`STATUS=DONE_OK`**
4. `build-install-mumu.ps1`（只出 APK）

脚本内门禁失败 → **停**；打印 AGT 拉回步骤；禁止装空壳 APK。未见 `STATUS=DONE_OK` = **没完**。

## 硬规则

1. **先跑本 skill 脚本**，禁止对话里逐步试 `flutter build` / `subst` / junction。
2. **禁止**在「主仓库」中文路径上 AOT。
3. **禁止** `subst` / junction 指回中文仓。
4. **必须**实拷贝 `C:\xrk-mobile`。
5. **缺 `runtime/out/arm64-v8a` 完整 rootfs → 禁止出包**。
6. **禁止 MuMu / 模拟器手测**；产品验收只认真机 arm64。
7. 壳 ≠ guest；Desktop 的 `C:\xrk-h` **不要**拿来打手机包。
8. 长构建 **前台可见**（skill `xrk-dev-surfaces`）。
9. **宣称 Host/对话 UI 已修** → 必须证明 `runtime/out` 用了本次 `ENGINE_TGZ`（或已发版 npm 版），不能只重打壳。

## 落点

| 用途 | 路径 |
|------|------|
| ASCII 构建树 | `C:\xrk-mobile\` |
| runtime（Gradle 真源） | 手机仓 `runtime/out/arm64-v8a/` |
| 本地 engine tgz | 本仓 `.release/mobile-engine/xrkseek-harness-cli-<ver>.tgz` |
| 手测 APK | `C:\xrk-mobile\out\xrk-harness-*-arm64-release.apk` |
| 包名 | `com.xrkseek.harness` |

## 今日踩坑

| 症状 | 根因 | 以后 |
|------|------|------|
| 「App 内运行环境包不完整」 | 只打了 arm64 壳，`runtime/out/arm64-v8a` 空/残 | 门禁 ≥80 MB rootfs；先 AGT 拉回 |
| MuMu 装上却跑不了 guest | 模拟器无可用 arm proot 虚拟终端 | **别装 MuMu**；真机 |
| 中文路径 AOT 255 | Unicode `app.dill` | 只在 `C:\xrk-mobile` 实拷贝上 build |
| subst / junction | Kotlin 跨根 / 仍解析 Unicode | 禁用 |
| 「本仓改了 Host 但手机还是旧的」 | runtime 仍 `npm install @xrkseek/harness-cli@已发版` | 走 **ENGINE_TGZ**；不必先 commit/publish |

## 相关

- 总控：`xrk-dev-surfaces`  
- 知识索引：`xrk-harness-knowledge-map`  
- 供应商表：`docs/llm-provider-presets.md`（与 pi-ai **手工同步**，非运行时引用）  
- mobile `tooling/build-apk.sh` · `runtime/build-runtime.sh`
