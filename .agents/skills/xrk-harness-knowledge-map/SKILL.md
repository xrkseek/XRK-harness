---
name: xrk-harness-knowledge-map
description: >-
  去哪读 XRK-Harness 的项目知识：发版链 / PowerShell 坑 / 桌面更新源 / GitHub-npm 网络 / 参考仓对照
  都在仓库 .agents/ 下（不入全局记忆）。在 XRK-harness 相关仓库干活、或要把这类经验写进
  MEMORY.md 之前读本篇，照索引去读真源，别把正文抄进记忆。
---

# XRK-Harness 知识索引（去哪读）

- **Status:** Accepted
- **Date:** 2026-10-22
- **Updated:** 2026-10-22
- **Tags:** knowledge-management, memory-hygiene, docs-index, repo-conventions
- **Related:** [`.agents/AGENTS.md`](../../AGENTS.md)（办事流程总表）· [`.agents/context/subagents.md`](../../context/subagents.md)（委派 / 角色工具面 / spill）· [`docs/adr/0011-tool-output-spill.md`](../../../docs/adr/0011-tool-output-spill.md)（子代理答案封顶）· [`docs/tool-output-bound.md`](../../../docs/tool-output-bound.md) · [`docs/adr/0001-typescript-only-host.md`](../../../docs/adr/0001-typescript-only-host.md)

> 本篇有两个角色，别混：
> 1. **索引** —— 主题知识（发版 / 网络 / 沙箱 / 投影层……）的正文**不在这里**，在下面的表格指向的文件里。不要抄进来。
> 2. **踩坑记录** —— 篇末「踩坑记录」节收的是**跨主题的方法论教训**（取证纪律、委派、文档约定）。这类坑不属于任何单个主题文件，故本篇是它们的真源。
>
> 项目知识**不写进全局记忆**（`~/.xrk/memories/MEMORY.md`）。仓库根：`C:\Users\xrkseek\Desktop\主仓库\XRK-harness`

## 什么时候用

- 要发 XRK-harness 版本 / 跑 release / 改发布文档
- 在 XRK-harness（或它的工作区）跑 PowerShell 命令踩坑
- 打桌面包 / 上 AGT 更新源 / 改官网 releases.json
- 要对照 `codex` / `deepseek-harness` 找差距，或复查旧差距清单是否已消化
- **准备把上面这些经验「记进记忆」时 —— 停，读本篇，知识已经在这里了**

## 索引

| 主题 | 读 |
|---|---|
| 发包链副作用 + 终态判据（push 必须先于 release、devDeps 双触发、E409/E403、SDK 先于 CLI） | `.agents/skills/xrk-release-chain/SKILL.md` |
| PowerShell / Windows 环境坑（管道毁文件、vitest filter、BOM、GBK） | `.agents/skills/xrk-ps-shell-pitfalls/SKILL.md` |
| 桌面未签名测包 + electron-updater 测试源 + AGT 上传顺序 | `.agents/skills/xrk-desktop-update-feed/SKILL.md`（机相关落点在同目录 `local.md`，gitignore） |
| GitHub API / npm 网络探测（直连 vs Clash 7897、大上传判流量） | `.agents/skills/xrk-github-npm-net/SKILL.md` |
| **参考仓差距取证**（codex / DSH 有什么我们没有、哪些是假差距、清单会不会过期） | `.agents/skills/xrk-reference-gap-audit/SKILL.md`（本轮结论在其 `reference/`） |
| 仓结构与插件开发 | `.agents/skills/xrk-harness-architecture/` · `xrk-harness-monorepo/` |
| 办事流程总表 | `.agents/AGENTS.md`「办事流程」段 |
| Face 投影层（init 不可共享常量、编号对齐 wire map、stateVersion） | `.agents/context/face-projections.md` |
| 向日葵免费（Bun 按平台 vendor；无 Bun 则跳过 OpenCode、Kilo 直连） | `.agents/context/sunflower-free-lane.md` |
| 子代理（角色工具面 `child_gap` · 并发限流 · 何时委派 · 输出 12k spill） | `.agents/context/subagents.md` |
| 检索仓内符号（先 CodeGraph 再 grep） | `.agents/skills/codegraph-retrieval/SKILL.md` |

## 决策

**项目知识落仓库 `.agents/`，全局记忆只留一句路由。** 三个理由：

1. **全局记忆有硬预算**（`MEMORY.md` 约 2.2k 字符，`USER.md` 约 1.4k）。一条发版链细节就能吃掉 10% 预算，而它对**非 XRK 会话**毫无用处 —— 记忆是跨所有工作区注入的。
2. **记忆没有版本控制**。`.agents/` 下的文件进 git，改动可 review、可回滚、可追责；记忆条目改坏了没有 diff。
3. **记忆的冻结语义**：会话启动时快照进 system prompt，本会话内的写入**不回灌**。真源必须在下次动手前用 `skill` / `read_file` 现读，才能拿到最新一条修正。

配套约束（不是本篇新造的，来自既有契约）：

- **产品默认**在 `apps/cli/seeds/` → `~/.xrk/`，任意工作区生效；**本仓增量**在 `.agents/skills/`，仅工作区 = 本 monorepo 时生效。两层**不得同名复写**（见 `.agents/README.md`）。
- 通用流程（委派 / Plan / 主线 / Canvas / MCP 挂载）是家目录种子 `xrk-delegate` 等；本仓**只放增量**，不抄第二份。
- 检索仓内符号先用 **CodeGraph**（`.agents/AGENTS.md` 有说明），别硬 grep。

## 后果

- **本 skill 的真源在仓库**。`~/.xrk/skills/` 下有一份**更旧**的同名副本（连同 `xrk-release-chain` 等）—— 一律以**仓库 `.agents/skills/` 版为准**，home 那几份是残缺子集。**想改就改仓库文件**（会入库），不要改 home 副本。
- 全局记忆里同类条目应当**压缩成一句路由**（例：「XRK 项目知识全在仓库 `.agents/`，动手前先读本篇」），不该复述正文。
- 新增一类项目经验时：**先在本表加一行，再写那个文件**；不要新开记忆条目。
- 本表若与实际文件树漂移（改名 / 拆分 / 删除），以文件树为准 —— 本表是入口，不是清单权威。
- 差距清单类内容（`xrk-reference-gap-audit/reference/`）自带**保质期**：本仓开发速度快，任何「我们缺 X」动手前须回本仓重新取证。

## 踩坑记录（本篇是真源 · 跨主题方法论教训）

> 每条都要有：**症状 → 根因 → 证据 → 以后怎么做**。没有证据的"经验"不写。

### P-1 · 一条差距结论，连着翻了两次（2026-10-22）

同一个候选（DSH 的懒解析工具参数 → 本仓 `argsRaw` 拼接），我从「P0 性能缺陷」一路改口到「不该动」。两次误判各有各的原因，都值得记。

**第 1 次：照抄对方的隐含假设。**
- 我在清单里写下"本仓 `argsRaw: base.argsRaw + delta` 是 **O(n²)** 拼接"。
- 实测推翻：**800 KB × 6 250 次拼接 = 0.2 ms**。V8 对 `acc = acc + p` 走 **cons-string（rope）**，不逐次 realloc；DSH 是 Rust `String`，那边才需要担心。**对方文档描述的是它自己运行时下的成本** —— "他们为此写了优化" ≠ "我们缺这个优化"。

**第 2 次：找到了真成本，但用错了度量口径。**
- 我转向 `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts:146`：流式期间每帧对**未闭合** JSON 做一次 `JSON.parse`。总量确实呈二次增长（200 KB → 237 ms · 800 KB → 3.2 s · 1.6 MB → 11 s），且 1 563 帧里 1 562 次必然抛异常。我据此仍判 P0。
- 口径错了：发布节奏是 `animation-frame`（`conversation-nodes/tool.ts:329-331`），**帧数由流时长决定、与体积无关**。按帧拆开测，分摊到每帧是**线性 ~37 µs**：@200 KB P50 **0.13 ms** · P99 0.31 ms · max 6 ms · **0 帧超 16 ms**；@800 KB P50 0.46 / max 8.0 / **0 帧掉帧**；1.6 MB 才出现 **1** 帧 21 ms。provider 吐字比本地 parse 慢一个数量级，所以这笔浪费**在墙钟里不可见**。
- **最终判定：浪费，但不可感知，不该修。** 为省 0.04 ms/帧去写一个增量 JSON 闭合扫描器是**负收益**（多一个缓存生命周期不变量 + 约 200 行 + 用户零感知）。这条差距**真正剩下的价值是呈现层**（preparing 行显示不出 `description`，见 P-8），不是性能。

**以后怎么做**：

1. 清单里凡带**复杂度或量级**（O(n²) / 内存 / 延迟 / 吞吐）的判定，必须先在本仓实测并把数字写进结论；否则只写"缺失某能力"，不写"性能差"。与既有纪律同源：**写「本仓更强」前须回对方侧取证** —— 反方向（写「本仓更弱」）同样要取证，本轮是被自己踩的。
2. 性能判定要测到**用户可感知的那一层**：前端看**单帧预算（16 ms）**，不是总耗时；总量二次增长可能只是"线性 × 更多帧"。分母找错，结论就反。
3. 动手前先读**该模块自己的注释**。`diff-card-model.ts:12-13` 早已写明 "paint as soon as JSON closes"（闭合后才画），所以每帧 parse 未闭合前缀**连它自己的契约都不要求**——既是浪费的线索，也是"这不是 bug"的线索。
4. 允许自己判"不做"。差距清单不是待办清单，**测完之后划掉**比硬凑一个修复更有价值。

### P-2 · 派活前不读 `child_gap`，子代理必然空转（2026-10-22）

- **症状**：派 3 个 `mem_seed_researcher`（调研员）去做"跑 `git diff` + 把长报告落盘"，三个全部空转（27–60 步、零产出）。
- **根因**：turn-start 的 `<session_capability>` 已明写 `child_gap: 调研员 · researcher · web,read-fs · omitted=…,bash,…,write_file,…`。**`researcher` 既没有 shell 也没有写盘工具**，任务从第一步就不可能完成。
- **以后怎么做**：需要 shell 或产出文件 → `worker` 面（`mem_seed_worker` / `mem_seed_fixer` / `mem_seed_tester`）。只读源码 + 搜网 + 回一段结论 → `researcher`。**取证类（要 git、要落盘）默认别派 `researcher`。** 细则见 `.agents/context/subagents.md`。
- **叠加放大**：免费路由（`free/kilo-auto/free`）同时 429，三个子代理各自卡在 `model-retry attempt 18/20 of 30` + 60 s 退避 —— 派错角色 + 并发 3 个 + 免费路由，三件事叠在一起才烧得那么难看。

### P-3 · `git grep` 的 `-A/-B/-C` 会被 PowerShell 吃掉（已有真源，本轮又踩）

- **症状**：`fatal: unable to resolve revision: …`。
- **真源**：`.agents/skills/xrk-ps-shell-pitfalls/SKILL.md:71` 已记 `git grep -n pat -A 5`；本轮以 `git grep -rn "a\|b" -- path` 形式**再踩一次**（`\|` 被 PowerShell 处理后 git 收到残缺 pattern）。
- **以后怎么做**：**文本搜索一律用 `grep` / `glob` 工具**（本仓有 ripgrep 封装，参数不经 shell）。用 `git grep` 时只传单 pattern、不用 `-A/-B`，需要上下文改用 `read_file`。

### P-4 · 门禁 warning 不一定是你引入的（2026-10-22）

- **症状**：`pnpm check` 打出 `verify-client-ui-i18n (desktop): 2 Client UI source file(s) use locale-owned copy.`，而本轮改动全是 `.md`。
- **判定**：既有告警，非回归。check **exit 0**、567 test files / 3 495 tests 全绿、kernel 覆盖率 99.04%（硬门 ≥90%）。
- **以后怎么做**：改文档也跑 `pnpm check` 是对的（防意外），但报状态时**必须区分"我引入的"和"本来就响的"**——本轮改动未触碰任何 `packages/client/**` 的 `.tsx`，可据此排除。

### P-5 · 参考仓的 `git fetch` 可能永远拉不到更新（2026-10-22）

- **症状**：`deepseek-harness` 反复 `fetch` 显示"Already up to date"，但 `git ls-remote origin` 显示远端 HEAD 早已前进。
- **根因**：`remote.origin.fetch` 被改成**只抓单个 tag**（`+refs/tags/dsh-v0.1.6-alpha.2:refs/tags/dsh-v0.1.6-alpha.2`），分支 refspec 缺失 → 分支永远不更新，且毫无报错。
- **以后怎么做**：更新参考仓前先 `git config --get-all remote.origin.fetch`；缺 `+refs/heads/*:refs/remotes/origin/*` 就补。另：本地该分支有检出时 `fetch origin master:master` 会被拒（`refusing to fetch into branch`），走标准 `fetch origin` + `merge --ff-only`。

### P-6 · ADR 编号不连续时，别悄悄补号（2026-10-22）

- **症状**：用户指定落 `docs/adr/0011-tool-output-spill.md`，而 `docs/adr/` 实际只到 **0009**，`0010` 在**全历史 / 全分支 / stash** 里都不存在。
- **做法**：照用户指定的号落盘，同时在 `docs/adr/README.md` 索引里**显式登记** `— | *0010 空缺（未曾存在，编号保留）*`，并把这条差异如实告知用户。
- **以后怎么做**：编号冲突 / 缺口**不自己改数、不假装没看见**。用户给的落点是契约，索引必须反映现实。

---

# XRK-Harness Knowledge Map (where to read)

- **Status:** Accepted · **Date:** 2026-10-22

This file is an **index**, not the body. Project knowledge does **not** go into global curated memory (`~/.xrk/memories/MEMORY.md`). The source of truth lives in the repo; find it via the table above.

**Use it when** you are releasing XRK-harness, hitting PowerShell traps, building a desktop package or AGT update feed, auditing gaps against `codex` / `deepseek-harness` — or when you are about to write any of that experience into memory. **Stop, read this, the knowledge is already here.**

## Decision

**Project knowledge lives under the repo `.agents/`; global memory keeps only a one-line pointer.**

1. **Curated memory has a hard budget** (≈2.2k chars for `MEMORY.md`) and is injected into *every* workspace. A release-chain detail eats 10% of it while being useless outside this repo.
2. **Memory is not version-controlled.** `.agents/` files are tracked — reviewable, revertible, blame-able.
3. **Memory is frozen at session start.** Writes made mid-session are not re-injected, so the freshest correction is only available by reading the file on disk before acting.

## Consequences

- **This skill's source of truth is the repo.** `~/.xrk/skills/` holds an **older** copy (as it does for `xrk-release-chain` etc.) — the repo `.agents/skills/` version always wins. Edit the repo, never the home copy.
- Existing memory entries of this kind should collapse to a single routing line, not a restatement.
- New categories of project experience: **add a row to the index first, then write the file.** Do not mint another memory entry.
- If this table drifts from the actual file tree, the tree wins — the table is an entry point, not an authority.
- Gap-audit artifacts (`xrk-reference-gap-audit/reference/`) have a **shelf life**. Re-verify against this repo before acting on any "we lack X".

## Pitfall log (this file is the source · cross-cutting methodology lessons)

> One line each; the full Chinese write-up above carries symptom / root cause / evidence / rule.

- **P-1 One gap conclusion flipped twice.** (a) *Copied their implicit assumption*: I logged our `argsRaw = base.argsRaw + delta` as "O(n²)" — measured **800 KB × 6 250 concats = 0.2 ms**, because V8 uses cons-strings (ropes); DSH is Rust `String`, where realloc is real. (b) *Found the real cost, measured the wrong denominator*: `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts:146` `JSON.parse`s the **unclosed** prefix every animation frame — totals do grow quadratically (200 KB → 237 ms, 1.6 MB → 11 s), but frame count is set by **stream duration, not size**, so per frame it is **linear ~37 µs**: P50 0.13 ms, P99 0.31 ms, max 6 ms, **zero frames over 16 ms** at 200 KB; still zero dropped frames at 800 KB. A provider emits an order of magnitude slower than we parse, so the waste is invisible in wall clock. **Final verdict: wasteful, imperceptible, do not fix** — an incremental close-scanner would cost ~200 lines plus a cache-lifetime invariant for zero user-visible gain. The surviving value of that gap is presentation, not performance.
  **Rules:** any gap claim carrying a complexity or magnitude must be measured in *this* repo first, number included — otherwise claim only "capability missing", never "performance worse"; measure down to the **user-perceptible layer** (frontend = 16 ms frame budget, not total time), since a quadratic total can just be linear × more frames; read the module's **own comments** before fixing (`diff-card-model.ts:12-13` already says "paint as soon as JSON closes"). And allow yourself to conclude "don't do it" — a gap list is not a todo list, and crossing an item off after measuring is worth more than forcing a fix.
- **P-2 Read `child_gap` before dispatching.** Three `researcher` children were sent to "run `git diff` + write the report to disk"; `researcher` has neither `bash` nor `write_file` — 27–60 steps, zero output. Shell or file output → `worker`. Details in `.agents/context/subagents.md`.
- **P-3 PowerShell eats `git grep` flags and alternation** (`unable to resolve revision`, truncated pattern) — already documented at `xrk-ps-shell-pitfalls:71`, re-hit this round. Use the `grep`/`glob` tools; one pattern only if you must use `git grep`.
- **P-4 A gate warning isn't necessarily yours.** `verify-client-ui-i18n (desktop): 2 … use locale-owned copy` fires on a docs-only change; check still exit 0 (567 files / 3 495 tests, kernel 99.04%). Report "pre-existing" vs "introduced" separately.
- **P-5 A reference clone can silently never update.** `remote.origin.fetch` had been narrowed to a **single tag refspec**, so `fetch` reported "Already up to date" forever while `ls-remote` showed the remote ahead. Check `git config --get-all remote.origin.fetch` first; add `+refs/heads/*:refs/remotes/origin/*` if missing.
- **P-6 Don't quietly renumber an ADR.** Asked for `docs/adr/0011-…` while the directory stops at **0009** (0010 absent from all history/branches/stash). Kept the requested number, registered `0010 vacant` in the index, and said so out loud.
