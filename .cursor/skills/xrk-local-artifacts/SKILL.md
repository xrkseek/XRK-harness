---
name: xrk-local-artifacts
description: >-
  本机产物固定落点、≤5 版本地备份、subst 仅 X:、测试/验收隔离 XRK_HOME。
  打包 Desktop、pnpm release、清理 .release / .desktop-build、手工测 CLI/Desktop 时使用。
---

# 本机产物与验收隔离

规则（自动挂载）：`.cursor/rules/xrk-local-artifacts.mdc`。  
教科书：[docs/publishing.md](../../../docs/publishing.md)「本机产物」· [docs/testing.md](../../../docs/testing.md) §10。  
Desktop 打包 / AGT 上传步骤：`.agents/skills/xrk-desktop-update-feed`。

## 何时用

- `pnpm package:desktop` / `upload:desktop` / `pnpm release` 前后
- `.release` 或 `.desktop-build` 体积膨胀、桌面根目录出现 exe
- 手工验收 CLI / Desktop，且本机已有日用 `xrkh` / `~/.xrk`
- 残留 `subst` 盘符（`subst` 命令有输出）

## 落点（唯一）

| 槽 | 路径 | 语义 |
|----|------|------|
| Desktop 当前包 | `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/` | 覆盖写；内含多版 exe 时靠 prune 裁到 ≤5 |
| 版本目录快照 | `unsigned-artifacts-<ver>/` · `upload-stage-<ver>/` | ≤5 |
| npm | `.release/xrkseek-harness(-cli)-<ver>.tgz` · `harness/` · `harness-cli/` | tgz ≤5；stage 树仅当前 |
| 手测 exe | `.release/desktop/<ver>/` | ≤5 |
| 开发壳 | `.desktop-build/development/home` | ≠ `~/.xrk` |
| CLI smoke | `XRK_HOME=%USERPROFILE%\.xrk-smoke` | 独立会话库 |
| vitest | `mkdtemp` / `withIsolatedXrkHome` | 结束后删除 |

## 流程

1. 打包前：优先 `C:\xrk-h`（已有结则直接用）。`subst` 应为空；不得在 `C:\` 建 `xrk-h-upload-*`。
2. 打包 / 上传：按 `xrk-desktop-update-feed`。
3. 手测 exe：复制到 `.release/desktop/<ver>/`，**不**放用户桌面。
4. 收尾：`pnpm prune:local`；若 `.release` 有杂文件再加 `--junk`。
5. 若用了 `subst X:`：结束后 `subst X: /d`，再查 `subst` 无输出。

## 验收 home

| 面 | 做法 |
|----|------|
| vitest | 不得依赖真实 `~/.xrk`；Host 测用 `withIsolatedXrkHome` |
| CLI | `$env:XRK_HOME="$env:USERPROFILE\.xrk-smoke"; xrkh …` |
| Desktop 未打包 | 默认 development home |
| Desktop 已安装 | 另开测试用户或临时 `XRK_HOME`，勿动日用家目录 |

## 命令

```bash
pnpm prune:local
pnpm prune:local -- --keep 5 --junk
pnpm clean:desktop
pnpm clean:desktop -- --snapshots   # 连版本目录一并删
pnpm clean:test-temp                # %TEMP%/xrk-* vitest 残留
```
