---
name: xrk-reference-gap-audit
description: >-
  对照参考仓（openai/codex、deepseek-harness）做差距取证，产出可执行清单并沉淀结论。
  用户说「更新参考仓」「看看他们有什么我们没有」「对比 codex / DSH」「差距清单」或要复查本仓是否已消化旧清单时使用。
---

# 参考仓差距取证（XRK-Harness）

> 参考仓只读：`C:\Users\xrkseek\Desktop\参考仓库\codex` · `C:\Users\xrkseek\Desktop\参考仓库\deepseek-harness`
> 结论落点：本 skill 的 `reference/`（进版本库）· 过程草稿落 `.tmp/compare/`（不提交）

## 铁律（每条都是踩出来的）

1. **先复核旧清单，再找新差距。** 本仓的差距清单**保质期极短** —— `方案.md`(10-19) 的 P0 6 条里 5 条、P1 里 8 条在两周内已被开发消化。照旧清单开工 = 重复实现已有代码。任何「我们缺 X」动手前，**先在本仓 grep 一遍**。
2. **写「本仓更强」前必须回对方侧取证。** 优势矩阵是高估重灾区。历史教训：`C1`（本仓 hooks 10 类「领先」）与 `D1`（子代理工具族「领先」）都曾被推翻 —— codex 实有 14 类 hooks + `multi_agent_v1` 九工具。
3. **每条结论带双侧证据。** 对方侧 `路径:行号` + 本仓侧 `路径:行号` **或**「零命中的确切搜索词」。无证据一律进「未取证」，不下裁决。
4. **四类判定，别混。** 真缺口 / 部分（有骨架缺子件）/ 假差距（本仓已有等价）/ 形态差异或定位差异（不算缺陷）。
5. **区分「定位差异」与「真缺口」。** codex = ChatGPT 订阅 + 云任务；DSH = DeepSeek 账号 + 远程模型目录 + 内置办公套件；**本仓 = 本地优先 + 用户自带 key**。云侧/账号侧/额度面整块排除，别列进清单。
6. **终端物理层不是缺口。** scrollback / 备用屏 / OSC 8 / Sixel / Kitty 键盘协议 / ratatui 渲染层 / 剪贴板 PRIMARY —— Web/Electron 壳无此问题域。正确做法是转成「**壳能力协商表**」。唯一例外：能力**本体**非终端专属的要单拎（如系统通知 —— OSC9/BEL 只是实现方式）。
7. **DSH 架构笔记是最强规格源，优先读它而不是读代码。** `参考仓库/deepseek-harness/.agents/notes/implemented/architecture/*.zh.md`（177 篇，每篇配中文）。里面有：问题 → 决策 → **实测数据** → 替代方案 → 影响。可直接抄的上限、毫秒数、失效条件都在。

## 流程

```
1. 更新参考仓（见下「网络」）
2. 定基线：记下旧 HEAD，算增量面
   git -C <ref> log --oneline <old>..<new>          # codex 164 提交里挑 UI/性能相关
   git -C <ref> diff --name-status <old>..<new>     # DSH 3698 文件 → 按顶层目录聚合看重点
3. 复核旧清单 → reference/baseline-recheck.md（本仓逐条 grep）
4. 取证新差距：参考侧读源码/笔记 → 本仓侧 grep 判真假
5. 落 reference/<本轮清单>.md（主交付）+ 过程草稿留 .tmp/compare/
```

## 更新参考仓

GitHub 直连时通时不通，代理 7897 通常可用。**绝不设代理环境变量**，只落单条命令参数：

```powershell
git -C <ref> -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 fetch origin --prune
git -C <ref> merge --ff-only origin/<branch>
```

DSH 的两个坑：① `remote.origin.fetch` 可能被改成**只抓单个 tag**（`+refs/tags/dsh-vX.Y.Z-…`），导致 `fetch` 永远拉不到分支 —— 先 `git config --get-all remote.origin.fetch` 查，缺 `+refs/heads/*:refs/remotes/origin/*` 就补上；② 本地 `master` 有检出时 `fetch origin master:master` 被拒（refusing to fetch into branch），走标准 `fetch origin` 再 `merge --ff-only`。

## 委派

**取证任务需要 `bash` + `write_file`，`researcher` 两者皆无** —— 派错角色 = 子代理空转烧步数。角色工具面、`child_gap` 判据与免费路由限流细则见 **`.agents/context/subagents.md`**（本仓真源，不在此处复写）。

本任务的默认选择：**主控自己 `git grep`** —— 范围明确的对照核查，本仓 grep 比子代理冷启动更快更准。

## 已知真缺口（截至 2026-10-22 · 动手前先复核本仓是否已做）

**交出去执行的那份**：`reference/2026-10-22-delta.md`（= 用户要的 Cursor 可直接执行清单，G1–G27 逐条带
对方出处 · 本仓 path:line 证据 · 落点文件 · 验收判据 · 优先级；含 §3 末「已核对不要做」表与 §5「已撤回请勿重做」）。
口径 = **DSH `dsh-v0.1.1-rc.2`(2026-08-21) → `dsh-v0.2.1-rc.2`(2026-10-17) 的增量**：11 条 bug-fix + 28 条 feature，
加 codex `89461ea6..45179176`。只学"这期间他们新增的"，不追旧版已有而本仓形态不同的东西。

逐项取证全文见 `reference/2026-10-22.md`；两份有出入时**以 delta 为准**（delta 含 A2 撤回后的定稿）。

**本回合终态**：`reference/2026-10-22-status.md`。

**算法/性能**：~~critical-path 库~~ · ~~wait_agent sleep~~ · ~~G1 useConptyDll~~ · ~~G4 禁 PID 偷锁~~ · ~~G6 promptTailGrace~~ · ~~G7 list 时间片~~ · ~~G12 perf:gate~~。仍缺：MCP 共享 / NAS journal / 路由定价 / 工具差分 / 两次结算 / 致命诊断。**G2** 归档 cancel 已有（确认流另排）。

> ⚠️ 「流式工具参数 O(n²)」**已撤回**（见 knowledge-map P-1）；呈现剩 **U7l**（本回合已落地 `partial-args`）。

**UI/UX**：~~系统通知 U1~~ · ~~U7l 字段懒读~~ · **U2 折叠单驱动仍缺** · chord / Ctrl+R / 主题 / 仪表盘 / Mermaid 仍缺。

**已确证的假差距（别再「补」）**：DSH `contextBreakdown` 状态体积优化（本仓 `breakdown-projection.ts` 本就是固定四数 + O(1) 增量）· DSH 三阶段工具调用（本仓 `tool.ts:54-74` `rootCallFromDelta` 已有）· `device-local-shortcut-preferences`（`shell-shortcuts.ts` 已有）· `sidebar-retained-tab-layout`（`AppFrame.tsx:18/313` 已有）· `composer-command-chip`（`chip-node.tsx:121` 已有）· Starlark 策略 DSL（本仓 `policy/src/when-expr.ts` 更贴合）。

## 反模式

- ❌ 拿两周前的清单直接开工（先复核）。
- ❌ 只读参考仓就下「我们缺 X」（没查本仓 = 无效）。
- ❌ 把云/账号/终端物理层当缺陷。
- ❌ 用 `researcher` 干需要 shell 的活。
- ❌ 一次性并发 3+ 子代理走免费路由。
- ❌ 把清单当待办塞进全局记忆 —— 细节在本 skill 与本仓文件里。
