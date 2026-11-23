# 会话底层优化真源

> **读者**：维护者 · Coding Agent（**笔记**，不是教科书）
>
> 对照基线：DSH v0.2.1-rc.3 + 本机 `~/.xrk/sessions` 实测（801 MB / 最大会话 ~69k 逻辑事件）。
> **本文件是会话差距与优化的唯一排期真源。** 旧 `docs/dsh-session-ref/*` 四份对照长文、
> `session-baseline-audit.md` 体检长文已删；过程归档见 `.agents/skills/xrk-reference-gap-audit/reference/`。

判定四类：**真缺口** / **部分** / **假差距** / **定位差异**。动手前先 grep 本仓。

---

## 1. 仍开放（按动手顺序）

### 写路径（卡 UI · 优先）

| ID | 缺口 | 实测量级 | 落点 | 做法 |
|---|---|---|---|---|
| ~~**R7**~~ | `session.truncate` / `replacePrefix` 全量删+重写前缀 | ~1.6 s（编辑重发主因） | `sqlite-store.replacePrefix` | **已落地**：同前缀走物理尾删；packed 跨界仍全量重写 |
| ~~**R6**~~ | `session.fork` / `seed` 全量 JS 重放 | 1.3–5.8 s 同步 | `forkSession` · `seedFromSession` | **已落地**：热库 `INSERT…SELECT` 拷前缀 + 只写 suffix；跨 packed / 冷库回退 `seed` |

### 读路径（可选性能）

| ID | 缺口 | 实测 | 落点 | 做法 |
|---|---|---|---|---|
| ~~**R8**~~ | history DB 仍全量读，分页只在 wire | 大会话首屏拷整数组；tail 200 = 1 ms（SQL 已能） | `readEventsTail` · `scanDurableSingles` · `session.history` | **已落地**：冷首屏只扩 durable 后缀 + 扫 singles  priming wire；`loadOlder` / 已驻留仍全量；hint 疑似物理计数则回退 |
| ~~**R9**~~ | 重键投影冷折仍贵 | 首屏 17 单元冷折 ~0.1–1 s；list-tier hydrate **已做** | `listProjectionCache` history 行 · `viewCheckpoint` | **已落地**：history-tier 与 list 同盘；冷 `session.history` 命中则只 `viewCheckpoint`（不 hydrate）；eviction list-remember 不再冲掉重键 |

### P2 / 产品决策（不挡写路径）

| ID | 缺口 | 判定 |
|---|---|---|
| **R10** | `prune(keep)` 无产品调用点 | **部分**：`reclaim()` / `gc --auto` 已有；`prune(keep)` 砍「按 sha 找回」需产品决策 |
| **R11** | 编辑重发 = 真删，无 superseded / 多版本回切 | 产品交互，非持久化契约 |
| **R12** | 压缩无 start/end 锁对 · `shadowedSeqs` | **定位差异**：单事件 `context/compaction` 已够 |

---

## 2. 已落地（勿重做）

| 域 | 内容 |
|---|---|
| 投影 / 查询 | evict · list-cache 身份 · FTS 短查 LIKE · FTS 失败诊断 · list hydrate · **R9** history-tier durable · parseState · turn/end remember · asOfSeq=min · 搜索封顶/游标 · eventWindow · session_trace · summaryKeys · view 去重 · predecessorTitle |
| 会话核心 | flush 屏障 · 拒读坏行 · lossless JSON · end-seed+forked · ignorable · history 丢旧 tool/result |
| 持久化 | schema 未来拒读 · flush 失败诊断 · DELETE `withImmediate` · seed/archive hint · **R7** 尾删 · **R6** `seedFromSession` SQL 拷前缀 · **R8** `readEventsTail` / `scanDurableSingles` |
| 遥测 / 标题 | `forwardOptional` · `basicRedactionRule` · seq=`readEvents.length` · 委托子跳过 title fallback |
| Checkpoint / fork 血缘 | restore `chatSeq`/`chatAhead`/`truncateChat` · `FaceForkLink.atSeq` |
| 基线已修（原体检 §2） | fork blank hint · archive hint 整行 · trimBeforeSeqCut · 任意轮分支 UI · FTS 双索引 · 投影 evict · shadow `reclaim` |
| 提供方 KV 前缀 | `tools[]` 禁活表 · `tool_search` 稳定 · `series-baseline`(+hydrate) · standing plan 尾部(+peel) · fragment/slash digest · 无 fragment last-wins 搬家 · system append delta · buildReq image offload · `costUsage.cacheHitRate` · process-cache · recipe inject · expand 回灌 · deferred 跳过 dynamicSchema（见 §5） |

假差距 / 定位差异（摘要）：live/persisted 枚举 · SOURCE_CONFLICT · Format V3 链 · 四分叉 derive · attempt settlement · `source.kind=provider` · 元数据必须进 sessions 表 · compaction 锁对。

---

## 3. 实测摘录与未提交改动收益

对照库：`~/.xrk/sessions`（本机 2026-10-27 探针：~21 万行 · 最大会话逻辑 ~13.4 万）。
基线数字来自更早探针；**收益以本机副本墙钟为准**（`.tmp/probe-gain.mjs`）。

### 3.1 历史基线（优化前）

| 路径 | 耗时 |
|---|---|
| `session.list` 冷扫 hints（205） | **≈7 s** → S5 后 **0.7 ms** |
| history 全量 hydrate（大会话） | 78–746 ms |
| history SQL 尾 200（仅 SQL） | ~1 ms |
| **`session.fork` 全量 JS 重放** | **1.3–5.8 s** |
| **`session.truncate` 全量重写** | **~1.6 s** |
| 首屏投影冷折 | ~0.1–1.1 s |

### 3.2 本轮未提交改动 · 可量化收益（诚实）

| 项 | 用户可感场景 | 测得 / 判定 |
|---|---|---|
| **R7** `replacePrefix` 尾删 | 编辑重发 / truncate 同前缀 | 干净库 32k 逻辑：尾删 **~75 ms** vs 全量重写 **~190 ms（约 2.5×）**。手段：前缀引用相等 + DESC 只扩被删后缀 + 绝对 `event_count`。基线大会话全量重写曾 ~1.6 s。packed 跨界仍全量重写。 |
| **R6** `seedFromSession` SQL 拷前缀 | fork 子会话 | **有条件**：物理切点干净时 `INSERT…SELECT`；packed 跨界回退 `seed`。父会话仍 `ensureLoaded`。小 keep 时 JS `seed(prefix)` 常更快。 |
| **R8** 冷 history 尾读 | 打开大会话首屏 log | 全量 hydrate **~0.3–0.7 s** → 尾 500 **~0.1 s（约 3–7×）**。hydrate 订正过期 `event_count`。 |
| **R9** history 投影 cache | 二次冷开首屏 | 命中则 **跳过投影 fold/hydrate**（中等会话曾估 ~124 ms–1 s）；与 R8 叠加后冷开可只付尾读。 |
| **hint / list** | 侧栏 | S5 已落地：冷 list **≈7 s → 0.7 ms**。 |
| **正确性** | fork end-seed、拒读坏行、FTS、list-cache… | 不直接加速，避免错标题 / 空搜 / 坏打开。 |

**总括：**

1. **最大体感**：侧栏冷 list（数量级）+ 编辑重发/截断同前缀（R7）。
2. **冷开首屏**：R8 尾读 + R9 投影 cache（二次开跳过重键冷折）。
3. **有条件**：fork SQL（R6）— 勿按一律 5× 宣传。

过程探针：`.tmp/probe-gain.mjs`。

---

## 4. 本轮优化进度

| 步 | 项 | 状态 |
|---|---|---|
| 1 | **R7** `replacePrefix` 尾删 | **已落地** |
| 2 | **R6** `seedFromSession` SQL 拷前缀 | **已落地** |
| 3 | **R8** history 冷首屏尾读 | **已落地** |
| 4 | **R9** history 重键 durable cache | **已落地** |

---

## 5. 提供方 KV 前缀（对照 DSH · 成本面）

> 基线：DSH agent-loop README「KV Cache effect」· `2026-09-20-dynamic-tool-updates` ·  
> `2026-10-22-series-start-unchanged-prompt-prefix`（实测相邻步 ~99.9% vs 误重写头节点 0.16%）。  
> 本仓目标：**降本且不减体验** — 活事实仍在 fragment / 工具结果里可见，只是不改 `tools[]` / message-0 前缀。

| 判定 | 项 | 证据 / 落点 |
|---|---|---|
| **假差距** | 系统提示 in-history 追加（步内） | `placeSystemOnWire` + Flash `systemPromptUpdate` |
| **假差距** | 动态上下文当 user 快照 | `additional_context` fragments（非改 system 前缀） |
| **已收** | `dynamicSchema` 灌 sibling / 名册 | `session-tool-copy` 指针化；活 ids → board / 工具结果 |
| **已收** | `tool_search` 描述塞 deferred catalog | 描述字节稳定；`list`/`*`/空查询浏览目录；关键词才 expand（体验不减） |
| **已收** | 跨回合丢失 leading system baseline | `series-baseline.ts`：in-history 路由记住 message-0；提示词变了只追加（对齐 DSH 系列前缀） |
| **已收** | 截断/删会话仍挂过期 baseline | `forgetSessionProcessCaches`：与 `request/header` 同批清 series-baseline + time-context（删会话 · log cut；LRU 驻留驱逐保留，会话可 remount） |
| **已收** | LRU 误清 toolDisclosure | 驻留驱逐保留 expand 名（与 series-baseline 同姿态）；删会话 / log cut 仍清 |
| **已收** | soft-budget 压缩后漏写 header | 压缩成功后 `reason:"change"` 强制 `request/header`；同步首建后再 rebuild 不再盖 `[current message]` |
| **已收** | deferred 白跑 dynamicSchema | `materializeTools` 先 `listForModel` 再 merge schema |
| **已收** | slash/recipe 进 system | 改 durable `context-fragment` inject（`## Recipe`）；message-0 不随配方变；模型仍可见 |
| **已收** | Host 重启 / 截断丢失 expand | `hydrate` 从最新 `request/header.tools` 回灌；log cut = forget 后立刻 hydrate（编辑重发不再空窗） |
| **已收** | standing plan prepend 断前缀 | `deriveMessages` **尾部**投影 open todos；plan 变不改 conversation 左端 |
| **已收** | 尾部 plan 挡 first-step skeleton | assemble 先 peel `isStandingPlanMessage`，lift 后再挂回尾部（否则丢 CURRENT_MESSAGE / 开局 time） |
| **已收** | context-fragment 每回合重追加 | `appendContextFragments` 按 `fragmentId+digest` 门控；同内容不写第二行 |
| **已收** | fragment last-wins 搬家断前缀 | `foldChat` 不再按 fragmentId 折叠；更新只追加在尾部（与 skill-catalog 同姿态） |
| **已收** | turn 开局无效 double offload | 用户图尚未入账时的 turn-start `ensureDurableImageOffloads` 已删；只留 `buildReq` 内扫描 |
| **已收** | slash recipe 无 digest 重追加 | 同 `slash-recipe` fragmentId + digest 门控；相同配方不二次写入 |
| **已收** | in-history 尾部重发整段 persona | `placeSystemOnWire` 只 append baseline 后缀 delta（plan/time 刷新不再双计 persona） |
| **已收** | Host 重启丢 series baseline | `hydrateSeriesBaselineFromLog`：最新 compaction 后首条 `request/header.system` |
| **已收** | 图 offload 中途改 wire | turn 开局先 `ensureDurableImageOffloads`（一步内再跑仍幂等） |
| **已收** | 会话命中率不可见 | `costUsage.cacheHitRate`（`billedPromptTokens` / `cacheHitRate`） |
| **真缺口** | `toolUpdate` / defer_loading | 本仓零命中；`tool_search` expand / Direct 工具增删仍整表重发 tools 段 |
| **部分** | follow-up time 进 system workspaceBlocks | 默认 ≥60s 才刷新；in-history 下以 **delta** 挂尾，不改 message-0；仍占尾部 uncached |
| **定位差异** | DSH 系统节点进 session 日志 | 本仓 system 每请求装配 + 进程内 anchor；不靠日志 system 节点 |
| **刻意不做** | 全 deferred / Messages `toolHistory` 照搬 | 伤 Direct 工具体验；DeepSeek Chat Completions 无 addition-only 半残 |

**Compact 的 cache 代价：** soft-budget / overflow / `/compact` 都会 `breakSeriesBaseline`——换窗后下一请求重基线，提供方前缀命中从接近 0 再爬。Flash 默认软压 **300k**（窗 1M）；压得越勤，账单上 miss 段越长。见 [session-compaction.md](./session-compaction.md)。

**动手顺序（成本）：** ① 禁 `tools[]` 活表 ✅ → ② 跨回合 series baseline ✅ → ③ expand 回灌 + recipe inject ✅ → ④ standing plan / fragment·slash digest / early offload / hydrate / system delta ✅ → ⑤ DeepSeek `toolUpdate: addition-only`（大件）→ ⑥ Status 看 `costUsage.cacheHitRate`。
