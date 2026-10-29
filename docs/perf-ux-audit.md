# XRK-harness 底层 UI/UX 与性能审计 · 完整优化方案

> 审计日期：2026-10-24
> 对照对象：`C:\Users\xrkseek\Desktop\参考仓库\deepseek-harness`（DSH，HEAD `22ddee3792`）
> 本文档所有结论都带落点文件与行号；标注 **实测** 的数字来自本机真实 `~/.xrk/sessions` 数据，
> 标注 **静态** 的来自代码阅读，标注 **估算** 的是按实测基线推算。

---

## 0. 怎么读

- **S 组** = 存储层（SQLite / WAL / 事件表），收益最大、改动最集中。
- **O 组** = 打开会话链路（Host 侧 SQL → 投影 → wire → 客户端装配）。
- **R 组** = React 渲染热路径。
- **F 组** = 闪动与滚动（用户说的「闪、跳、不丝滑」）。
- **U 组** = 交互能力缺口（对照 DSH，用户说的「反人类」）。
- **L 组** = 内存无界保留。
- **B 组** = 包体与启动。

每项统一给：**证据 / 开销 / 改法 / 风险 / 验证 / 落地性**。
落地性标记：

| 标记 | 含义 |
|---|---|
| ✅ | 局部改动，本轮可直接做，无协议/产品决策依赖 |
| 🔗 | 需要配套（schema 迁移 / 协议字段 / 多包联动），但方案已确定 |
| ⚠️ | 需要产品决策或破坏性取舍，方案给了默认建议 |

---

## 1. 实测基线

### 1.1 会话存储（本机真实数据，2026-10-24）

| 指标 | 实测值 | 说明 |
|---|---|---|
| `sessions.db` | **745.1 MB** | page_count 190,736 × 4096 |
| `sessions.db-wal` | **534.9 MB** | 从未被回收 |
| `sessions-archive.db` / `-wal` | 26.5 MB / 82.8 MB | 归档库同样不回收 |
| 会话数 | 205（`sessions` 表）/ 209（当前） | |
| events 行数 | **183,982** | |
| payload 有效字节 | **321 MB** | 745 MB 里只有 43% 是有效 payload |
| freelist | 5,619 页 = 22 MB | 未 VACUUM |
| FTS | trigram，36,119 文档，data 表 73,264 页 | 体积大头之一 |

**事件类型分布（按占用字节）**：

| 类型 | 行数 | 字节 | 占比 |
|---|---|---|---|
| `request/header` | **1,319** | **134.7 MB** | **42.0%** |
| `tool/result` | 19,176 | 61.3 MB | 19.1% |
| `assistant/message` | 15,330 | 32.8 MB | 10.2% |
| `text-chunks` | 22,856 | 22.6 MB | 7.0% |
| `assistant/chunk` | 48,473 | 18.8 MB | 5.9% |
| `tool/call` | 18,581 | 14.3 MB | 4.4% |
| `tool-call-chunks` | 11,503 | 12.1 MB | 3.8% |
| `context/compaction` | 93 | 8.0 MB | 2.5% |
| 其它 | ~54k | ~15 MB | 4.7% |

三条结论：

1. **`request/header` 单类占 42%**，UI 从不渲染它。最大单条事件 247 KB，就是一条 header。
2. **流式 chunk 双写**：`assistant/chunk`（48,473）+ `text-chunks`（22,856）= **71,329 行 / 41 MB**，同一份 token 流存了两遍。
3. 最大单会话：`sess_muvhe8k8_8rorml` 6,505 事件 / 17.9 MB；`sess_muwxejnt_hkfzpt` 2,584 事件却有 **29.2 MB**（巨型行集中）。

### 1.2 打开一个会话（实测，`node:sqlite` 只读，取 3 次中位）

| 操作 | 耗时 |
|---|---|
| A. 全量 `SELECT payload … ORDER BY seq`（6,505 行） | **47.3 ms** |
| B. 全量 6,505 次 `JSON.parse`（17.1 MB） | **95.2 ms** |
| C. 尾部窗口 `ORDER BY seq DESC LIMIT 200` | **0.5 ms** |
| D. 尾部 200 行 + parse | **0.8 ms** |
| E. `COUNT(*)` 全表 | 7.7 ms |
| F. 205 会话 `MAX(seq)` 聚合 | 15.6 ms |
| G. `ORDER BY LENGTH(payload) DESC LIMIT 10`（全表扫） | **602.9 ms** |

**A+B = 142 ms 只是 I/O + parse 的下限**，还没算投影 fold、wire 适配、客户端装配、DOM 挂载。
而 **C+D = 0.8 ms**——分页比全量快 **180 倍**。这是 O 组所有改动的收益上限依据。

### 1.3 侧栏列表冷刷新（实测，205 个会话逐个查）

| 查询 | 205 次总耗时 |
|---|---|
| `SELECT MAX(ts) FROM events WHERE session_id = ?` | **4,393.8 ms** |
| `SELECT 1 … json_extract(payload,'$.type')='turn/start' LIMIT 1` | 24.1 ms（157 命中） |
| `SELECT 1 … json_extract(payload,'$.type')='command/run' LIMIT 1` | **2,578.6 ms** |
| **合计** | **≈ 7.0 秒** |

原因：`MAX(ts)` 无法走 `(session_id, seq)` 主键，必须扫该会话全部行页；`command/run` 绝大多数会话没有，等于每次都全扫。
**这是「侧栏点一下要等几秒」的直接原因**（S5 用一列解决）。

### 1.4 前端包体（`apps/web/dist` 实测）

| 文件 | raw | gzip | brotli |
|---|---|---|---|
| `plugins/@xrkseek/client-ui-conversation/client.js` | **1,518 KB** | 347 KB | **273 KB** |
| `plugins/@xrkseek/client-runtime/client.js` | 447 KB | 104 KB | 87 KB |
| `plugins/@xrkseek/client-connection/client.js` | 418 KB | 90 KB | 69 KB |
| `assets/index-*.js` | 847 KB | 256 KB | 212 KB |
| `assets/vendor-*.js` | 754 KB | 183 KB | 152 KB |
| **首屏合计** | **3,985 KB** | 979 KB | **793 KB** |

全部 JS 9,314 KB / 72 文件；sourcemap 8,656 KB（**未随包发布，符合预期**）。
`ui-conversation` 单包 1.5 MB raw 是首屏最大单点，且它把 Chat 视图、composer、skeleton 全塞在一起。

### 1.5 本轮已落地并验证的改动

#### 存储层（`packages/core/session`、`packages/session-format`）

| 项 | 改动 | 实测 |
|---|---|---|
| S2 | `wal_autocheckpoint=1000` + `journal_size_limit=64MB` + `close()` 里 `wal_checkpoint(TRUNCATE)` | 真实库副本：WAL **534.9 MB → 0 MB**（272 ms） |
| S2b | **运行时** WAL 收缩：`flushPending` 末尾（含空 flush）按 60s 限频 + 64 MiB 阈值做 `wal_checkpoint(TRUNCATE)`；`walShrinkMinBytes` / `walShrinkIntervalMs` 可注入供测试 | 真实库 `-wal` 561 MB（帧早已全部回写、`busy=0`）→ TRUNCATE **37 ms 归零**。新增 `wal-shrink.test.ts` 3 条：同 workload 下低阈值 store 为 **0 B**、默认阈值为 **~1.5 MB**、收缩后重开数据完好 |
| S1 | `synchronous=FULL→NORMAL`；`user/message` 事务内临时升回 FULL | 2,000 事件/40 事务：**143 ms → 8 ms（15–23×）** |
| S5 | schema v3→v4：`sessions` 加 `last_ts / event_count / has_turn_start / has_command_run`，`flushPending` 同事务维护，`listHints` 冷路径改读列 | backfill 一次性 **2.1 s**；`listHints` 216 次 **0.7 ms**（旧 `MAX(ts)` 冷读 4.4 s） |
| O11 | `initSchema` 当前版本快路径（`sqlite_master` 存在性探测，保留 `DROP TABLE` 自愈） | 启动少 2 轮 DDL |
| O5 | `pathAllowlist.hydrate` 增量水合（`primedLen`）；`repairOpenTurnEvents` 的 `log()` 缓存拼接 | 第二次 open 少 2 遍全扫；修复路径 O(n²) → O(n) |
| O7 | `listProjectionCache.remember` 改 debounce（500ms，`unref`），`flushNow` 供关闭时同步 | open 尾延迟去掉一次同步全量 JSON 写盘 |
| O9 | `paginateSessionHistory` 去掉 `beforeSeq` 线性探测（`eventSeq(i)===i+1`） | 每次 loadOlder 少一遍全页扫描 |

| O2a | `projections.checkpoint(sessionId, {keys})` 支持 key 过滤；`session.history` 与 `rememberListProjections` 只取 list-tier keys | 原先对 ~17 个注册单元各做一次 `cellFor` + `structuredClone`，其中未物化的单元会**整段重放日志**；现在只碰 2 个 list key |
| O6 | `effectiveSandboxMode` 由全量 fold 改倒扫 `lastSandboxMode`（新增导出） | `sandbox/mode` 是唯一写 sandbox 旋钮的事件，倒扫与 fold 等价但 O(1)；路径闸门每次工具调用都会问 |

#### 前端（`packages/client`）

| 项 | 改动 | 证据 |
|---|---|---|
| R2 | `toolRowModel` 单次 `parseArgs` + `body` 惰性 getter（`onceValue` 记忆）+ `GenericToolCard` `memo` + 按 card tag `switch` 只调一个 builder | 折叠态 `JSON.stringify` **0 次**（旧 1）、`JSON.parse` **1 次**（旧 3）；`ui-tool` **265 passed** |
| R3 | 侧栏三处 `useSessions(s => s)` 收窄为 `{ids, byId, current}` + 相等函数；`SessionNodeItem`/`ProjectRowItem` `memo` + 显式比较器；drag 回调上提；菜单项 `useMemo` | 新增 `row-scope` 4 测试：改 Alpha 时 Beta 渲染 **0 次**；反证（比较器改 `() => false`）3 条全红 |
| R4 | `PresenceBall` 10 个内联 uSES → 1 个稳定订阅 + 指纹缓存；`MutationObserver` 提模块级单例 | 重渲染 10 次后 subscribe 增量 **0**（旧 +9/次），observer **1 个**（旧 +1/次） |
| R7 | `ConversationSession` 去掉整份 input 订阅，改用首帧钉住的选择器 | 两次 draft 写入后外壳渲染仍 **1 次**（旧 4 次）；种子不回退 |
| R8 | `DetailsPanel` 的 `pretty` / `rawResultText` 加 `useMemo` | 切换选中不再在渲染期 parse+stringify |
| L3 | `ReasoningRow.expandedByKey` 加 200 条 LRU；body 冻结前缀 + ≤1535 字符可变尾 | 2 万字流式：冻结节点 `nodeValue` 不变，只重写尾节点 |
| L1 | `TrajectoryView.trajectoryPaint` 渲染期写 → `useMemo`+`useEffect`，LRU 3，卸载释放 | 卸载后重挂同 session 不再命中；第 4 个 session 淘汰最旧（旧版两者都 fail） |
| L2 | `OverviewChangesPanel.diffPaint` LRU 32 | 第 33 个 key 淘汰最旧；命中语义不变 |
| U6 | `Menu` 补 WAI-ARIA 方向键 / Home / End（roving focus） | 原先只有 Escape |

#### 评估后**不做**的项（附实测依据，避免重复尝试）

| 项 | 结论 |
|---|---|
| F2 滚动 rAF 合并 | 试过并回滚：延迟 `chatScroll.save` 会破坏 anchored-prepend 与 remount 恢复语义（jsdom 无 `elementsFromPoint`，兜底扫描就是唯一路径），`chat-view` 测试从 11 红变 13 红。留给 R1 窗口化时连同 `pagingAnchor` 一起重写。 |
| O10 `pending` 改 Map | `pending` 还有「按引用回滚单条」与「FTS 内存匹配」两处需要按引用遍历，改 Map 要同时重写三处语义，收益（fan-out 时 O(m) 扫描）与风险不匹配。 |
| R1 主列表换 `react-virtual` / 上 `content-visibility:auto` | 已 memo 到节点级（`ChatNodeSeat`/`AssistantNodeView`/`MessageItem` 各 view 均 `memo`），`ChatView.module.css` 里留了实测注释：`content-visibility:auto` 的 skip/unskip 在 Chromium 下把 turn-tail footer（改动 card、复制/赞/用时）画出**幽灵副本**，即使子行 opt-in `visible` 也不消失。换虚拟化库要重写贴底/锚点/paging 全套，与 F2 同一族时序风险；收益只剩 DOM 节点数。需要产品先接受「折叠已完成 turn」再谈。 |
| S4 `request/header` 瘦身（每轮全量 tools schema） | 实测确认是**已修的历史遗留**：`request-header-log.ts` 的 `requestHeaderRouteEquals`（忽略 system、只比 config+tools+adapterDefaults）已生效。真实库 1343 条 / 136 MB 中 86%（112 MB）是 10-04～10-08 写的，10-09 起每天 ≤3 MB、近 24h 仅 86 条 6 MB。**不再改代码**；要回收只能压历史事件，破坏 append-only 无损日志，不值得。 |
| S6 FTS 索引收窄（`search_fts` 347 MB） | 实测：`search_fts_data` 303 MB + `search_fts_content` 43 MB，而被索引文本仅 25 MB —— 膨胀来自 `tokenize='trigram'`（中文任意子串可搜的代价），换 tokenizer 等于砍功能。另：`text-chunks` 贡献 16.7 MB 索引文本（`assistant/message` 只有 1.2 MB），说明流式正文确实存在无 message 的部分，`search-text.test.ts` 也明确锁定了「chunk 要入索引」，删掉会真的丢搜索能力。 |

#### 性能基线：把假门禁换成真门禁

`scripts/perf-gate.mjs` 原先 fold 一个手写的数组（注释自称 "minimal stand-in"），**对本仓任何改动都不会变红**。现已改为驱动 `packages/core/session/dist` 的真实 store：

| 模式 | 内容 |
|---|---|
| `pnpm perf:gate` | 临时目录写入 1 万条真实形状事件 → 断言事件数一致、`writeMs ≤ 4 s`、`coldReadMs ≤ 1 s`、**close 后 WAL 必须为 0**（S2 的回归哨兵）。实测：write **1.22 s**、`list` **0.01 ms**、`coldRead` **0.028 ms**、WAL close 后 **0 B** |
| `-- --dir <sessions>` | 只读体检真实库：db/WAL/archive 体积、会话数、事件行数、payload 体积、事件类型 top 8、`dbstat` 表体积。实测本机：db **754.5 MB** + WAL **534.9 MB**、220 会话、195 998 行、payload 319 MB |

`--self-test-fail` 仍强制红灯（已验证 exit 1）。

#### 冷开一个大会话的真实成本（实测 7 911 行 / 81 177 事件）

| 阶段 | 耗时 |
|---|---|
| `JSON.parse` 每行 | 34.9 ms |
| `expandPackedStorageRecords` | 13.9 ms |
| `assertSessionEvent`（逐事件完整校验） | 41.0 ms |
| `projections.snapshot()` 冷 fold（15 个 key） | **123.9 ms** |
| `snapshot()` 热路径 | 0.2 ms |
| **合计** | **~214 ms** |

结论：**O2（投影 checkpoint 落盘 + 冷启 restore）能省掉 124 ms 的 fold**，但要新表/新落盘格式 + 部分 checkpoint 的 `restore` 语义（当前缺失的 unit 会抛错），代价与「一次冷开省 124 ms」不匹配，暂不做；`assertSessionEvent` 的 41 ms 是磁盘损坏防护，保留。真正能一次砍掉 200 ms 的是 O1（SQL 尾页）——它仍需要 O2 作为前置。

#### 首屏包体（`apps/web/dist`，实测）

| chunk | 体积 | 构成 |
|---|---|---|
| `index-*.js` | 847 KB | react-dom **48%**、`packages/client` **35.5%**、react 8% |
| `vendor-*.js` | 754 KB | **katex 35%**、`@shikijs/langs` 14%、micromark 系列 ~18%、shiki core ~8% |
| `langs/*.js` | 单语言 400–800 KB | 已按需拆分（不在首屏） |

katex 是唯一明显可拆项（约 77 KB gzip），但桌面端从本地磁盘加载首屏，收益接近零；web 端收益也小于「一次会话冷开」的量级。**B2 不做**。

#### 清单里其实已经实现的项（避免重复开发）

| 项 | 现状 |
|---|---|
| U2 桌面链接接管 | `apps/desktop/src/main.ts` 已有 `setWindowOpenHandler`（http/https → `shell.openExternal`，其余 deny）+ `attachDesktopNavigationGuard`；web 端 `target=_blank` 本就正确 |
| U4 密钥遮蔽 | `@xrkseek/secrets` 的 `redactSecrets` 已覆盖失败展示（`failure-display.ts` 4 处）、记忆写入、设置面 `describe({redactSecrets:true})` |
| S3 chunk 双写/打包 | `chunk-pack.ts` 已把连续 chunk 打成 `text-chunks` / `tool-call-chunks` 物理行（实测 24 464 行承载 8 万+ chunk） |
| U7 轨道虚拟化 | `ui-trajectory` 表格已用 `@tanstack/react-virtual` |

#### 长会话滚动热路径（本轮）

`ChatView.pagingAnchor` 原来在**每个 scroll 事件**里做 4 次 `elementsFromPoint` 命中测试（top / 1/3 / 1/2 / bottom），全落空时再 `querySelectorAll` + 逐行 `getBoundingClientRect()` 全量扫描 —— 长会话里这是每帧 4 次强制布局 + O(行数) 次几何读取。

现改为 DSH 的单点 + 二分（`use-chat-viewport.ts:502-537` 同构）：

| | 改前 | 改后 |
|---|---|---|
| 命中测试 | 4 个点 | **1 个点**（`viewport.top + 1`，读者视线进入处） |
| 命中失败兜底 | O(rows) 次 `getBoundingClientRect` | **O(log rows)** 二分（行 top 在文档序单调递增） |
| jsdom 行为 | 全 0 矩形 → `rows[0]` | 二分走到末尾 → `rows[0]`（**完全一致**） |

**第二轮：行内复用 + 分页锚点语义分离。** 单点探测之后每帧仍有 1 次 `elementsFromPoint`、1 次 `[data-composer-seat]` 查询、4 次 `getBoundingClientRect`（scrollport / composer / list / 命中行）。但一个 scroll tick 绝大多数时候**没有跨行** —— 阅读线还是落在同一行里，再探一次必然解析出同一个元素。

于是 `scrollPosition` 记住上次解析出的行（`AnchorProbe`），下一帧先量这一行：

```ts
if (held !== null && held.isConnected && list.contains(held)) {
  const rect = held.getBoundingClientRect()
  if (heldKey !== undefined && rect.bottom > viewport.top + 1 && rect.top <= viewport.top + 1) {
    return { anchorKey: heldKey, anchorTop: rect.top - viewport.top, scrollTop }
  }
}
```

判定条件与 `pagingAnchor` 的二分完全同构（「bottom 越过阅读线的第一行」），所以复用与重探等价。稳态每帧从 **4 rect + 1 hit test + 1 selector** 降到 **2 rect**，只在跨行那帧才付全价。

同时把两个被混用的语义拆开：

| 用途 | 函数 | 成本 | 语义 |
|---|---|---|---|
| 保存阅读位置（每次 scroll） | `scrollPosition` → `pagingAnchor` | 稳态 2 rect | **视口命中**：必须指名读者看见的那一行 |
| 分页锚点（`loadOlderAnchored`） | `documentOrderAnchor` | 1 selector + 1 rect | **文档序首行**：prepend 让所有行同量下移，钉住首行等价于钉住视线，且零命中测试 |

拆开之前两者共用 `pagingAnchor`，分页为此付出它不需要的视口语义（命中测试 + 可能的二分扫描）。

`ui-conversation` 全包测试：**13 failed / 35 passed**，与改动前基线**逐条相同**（3 个失败文件同为 chat-view 的 11 条「插队中」文案 + conversation-node-definitions 1 条 + queue-dock 1 条，全部来自工作树里并发修改 `locales.ts` 的会话）。tsc：改动后 35 errors，基线 36（删掉的死代码顺手少 1 条）。eslint（三个改动文件，`--no-ignore`）：0。

**顺手：`anchorElement` 从 JS 扫描换成属性选择器。** 它原来 `querySelectorAll` 出全部行再逐个比 `dataset`，而 `realizePendingJump` 在 jump 未落地时**每帧**从 layout effect 调它 —— 长会话就是个每帧 O(rows) 的 JS 循环。现在直接 `querySelector('[data-chat-anchor-key="…"]')`（与 e2e 套件定位同一批行的写法一致），只剩 `\` 与 `"` 的转义，因为 key 恒为 `node:` / `call:` 身份。

第二轮验证与第一轮同表：**13 failed / 638 passed**，失败集合逐条相同；tsc 35；eslint 0。

#### 死补丁清理：`data-live` 与每行 480 ms 定时器（本轮）

`ChatNodeSeat` 每行调 `usePostStreamLive(streaming)`，settle 后再保持 `data-live` 480 ms，注释说这是为了不让 `content-visibility: auto` 把展开的 Think 行刷成空白。但 `content-visibility: auto` **早已从 `.flowItem` 移除**（全仓只剩 3 处注释提到它），`data-live` 在 `ui-conversation` 的 CSS 里**零消费者**（`git grep data-live -- "*.css"` 只命中 `ui-plan/PreviewTabs`，那是另一个组件的独立用法）。

于是每行在 settle 时都白挂一个 `setTimeout(480)` + 一次 `setState` 重渲染：90 轮会话 ≈ 200 行 → 200 个定时器同时到期、200 次渲染。

已删除 `usePostStreamLive` 调用、`data-live` 属性、`use-post-stream-live.ts` 与其测试，并在 `ChatNodeSeat` 留注释写明「重新引入 paint containment 时必须恢复这段宽限」。

#### 折叠动效：调研结论是「现在不能抄」

两份对照调研（DSH `flow-motion.ts` 538 行 / `use-chat-viewport.ts` 849 行 / `searchable-hidden.ts` 45 行，逐行取证）给出三个硬约束，任何一条没解决都会做出更糟的效果：

1. **XRK 没有「整行折叠」这个业务层**。`chat-snapshot-builder.ts:202-206` 的 `orderedVisible()` 直接 `.filter(node => node.visibility === 'visible')`，隐藏的节点**根本不进 DOM**。DSH 的第一原则正相反（`ChatGroupSeat.tsx:1`：*display policy changes visibility, never member parents*）。动效是最后一层，必须先有「哪一行该藏」的判定（`processMember` / `stepGrouping` / `deferCollapse`），否则没有可动画的对象。
2. **`gap: 16px` 与 `hidden="until-found"` 直接冲突**。`hidden="until-found"` = `content-visibility: hidden`，元素**仍生成盒子**（高度塌 0 但仍是 flex item），flex `gap` 照样在两侧各加 16px → 折叠一行凭空多 32px。要可搜索的折叠，必须同时把 `.column` 的 `gap` 换成 DSH 那套 `:not([hidden]) ~ :not([hidden])` 逐兄弟 `margin-top`。
3. **批次比 CSS 过渡短会死锁**。DSH 的兜底是 `50 + 110 + 80 = 240 ms`，而 `transitionend` 通常 160 ms 到；若把 `SETTLE_SLACK_MS` 设小，Chromium 偶发不发 `transitionend`（元素已 `hidden`）→ `foldActive()` 永远 true → 预留的底部空间永不回收。

顺带两个纠正（避免照着不存在的接口写）：DSH **没有** `itemAtPointer`（那是 XRK 独有）；DSH 的 `use-chat-reading` / `use-chat-viewport` **不依赖** `store` / `ui-renderer` 包，只依赖 React 与本地 contract 类型。

#### 折叠业务层：已落地（`process-groups.ts` + `ProcessGroupSeat`）

上面的结论 1 就是这一节做的事：**先有「哪几行成组、组该不该折叠」的判定，再谈动画**。

**业务层** `conversation-nodes/process-groups.ts`（纯函数，9 条单测）：

| 判定 | 规则 | 与 DSH 的差异 |
|---|---|---|
| 谁是 process 成员 | `tool-call`；以及**只有推理、没有正文** 的 `assistant-step` | 同 DSH |
| 谁留在组外 | 带 `text` 块的 `assistant-step`（回答） | DSH 把同一 Node 拆成两行（reasoning 进组、reply 出组）；XRK 的 `assistant-step` 是**一个 DOM 行**，拆行会破坏 `data-chat-anchor-key` 的一行一锚，所以有正文的 step 整行留在组外 |
| 成组门槛 | **连续 ≥ 2 行** | DSH 是 ≥ 1。XRK 的 `tool-call` 行本身已是一行标题，单行再包一个组头就是两层标题、什么也没藏住 |
| 边界 | 遇到非 process 行 **或 Turn 变化** 就 flush | 同 DSH（per-Turn 分组） |
| 组身份 | `process:<首个成员 key>` | DSH 用 stateful `extendedGroup` 保持增量身份；XRK 的行序已是投影输出，首成员 key 天然稳定——尾部追加成员不改 key，已展开的组不会被重置 |

**UI 层** `chat/ProcessGroupSeat.tsx`：一个组头按钮（`aria-expanded` + chevron + 「N 个工具调用 · 思考 N 次」），下面是成员。

折叠态用 **CSS grid 行过渡**（`grid-template-rows: 1fr ↔ 0fr`，180 ms），不是 `display: none`：

- **成员必须留在 DOM**。折叠后它们仍是 `data-chat-anchor-key` 序列的一部分，滚动位置还原与阅读探测都读这个序列；`display: none` 会让「折叠」在锚点看来等于「删了这几行」。
- `grid-template-rows: 0fr` 需要内层 `min-height: 0` —— grid item 默认 `min-height: auto`，否则拒绝收缩到内容以下。
- 这里**不需要** DSH `flow-motion.ts` 的批次编排：那套是为了「折叠 + 让出底部空间 + 滚动跟随」三者同步，XRK 的折叠不动 `scrollHeight` 的跟随逻辑（浏览器默认 scroll anchoring 会保持视觉锚点），所以一条 CSS 过渡就够，也避开了上面结论 3 的 `transitionend` 死锁。

**默认态**：`pinned === null` 时跟随 Turn —— 关闭的 Turn 折叠，进行中的 Turn 展开（DSH `standard` 行为）。点一次就钉住读者自己的选择，且只在**新挂载**时回到跟随（组件 state，不落库）。`Open / 展开` 的选择按 `process:<first>` 身份保留，所以「组尾多了一个工具」不会把已展开的组弹回折叠。

**验证**：`process-groups.client.spec.ts` 9 条全绿（含「跨 Turn 不合并」「单行不成组」「尾部追加不改 key」「空白推理不算 process」）。`ui-conversation` 全包 **13 failed / 647 passed** —— 失败集合与改动前**逐条相同**（那 13 条来自工作树里并发修改 `locales.ts` 的会话），新增的 9 条就在这 647 里。tsc 35（基线 35）。

**未做的部分**：DSH 的 `presentation-policy`（compact / standard / detailed / verbose 四档）没有移植 —— XRK 没有「工作详情模式」这个设置项，先按 standard 一档落地；要加档位时，`FlowEntry` 已经在渲染前算好，档位只需决定「closed 时是否默认折叠」这一个布尔值。

#### 发消息那一瞬间的三处不丝滑（用户直接指出的）

**① 空注入行。** 发消息时 Host 会先写一条 `context` 节点（`beforeUserMessage`），列表因此 +1 行、气泡下移。为了让气泡「不跳」，旧代码在 echo 期间**主动塞一个占位行**（`reserveInject` → `ContextInjectionPending`）撑住位置 —— 代价是读者眼里凭空出现一条「上下文注入」再消失。

删掉占位（`reserveInject` / `injectHold` / `contextCount` 全删，`ContextInjectionPending` 组件随之不再被引用）。**不加任何入场动画**：读者贴底时内容在底部增长，`shouldFollowContentGrowth`（`ChatView.tsx:1055`）会把视口重新钉到地板上，新行从下方进入而不是把气泡顶下去；读者不贴底时新行落在视口下方，本来就不影响他。真正多余的只有那条幽灵行本身。

**② 上一轮结尾「闪一下」—— 这是我上一轮引入的。** 折叠组在 Turn 关闭那一刻从展开变折叠，于是结尾的 turn-tail / 改动卡 / 统计行整体上移，读者看到的就是「结果闪了一下」。

修法按 DSH `ChatGroupSeat.tsx:140` 的 `deferCollapse = bottom && …` 语义，但做成**锁存**而不是持续跟随 `atBottom`：

```tsx
const [latched, setLatched] = useState<'open' | 'closed' | null>(null)
useEffect(() => {
  if (entry.closed && latched === null) setLatched(deferFold ? 'open' : 'closed')
}, [entry.closed, deferFold, latched])
const folded = pinned ?? (latched === 'closed')
```

为什么必须锁存：如果直接写 `folded = entry.closed && !atBottom`，读者一旦往上滚，**所有**历史组会同时折叠、布局剧变 —— 把「瞬间收起」换成了「滚动中崩一下」。锁存只在 Turn 关闭那一刻决策一次：读者贴底就保持展开（他正在看回答），此后滚动不再重判；读者不在底部才折叠（那个 Turn 不在他眼前）。`pinned`（读者点击）优先级最高。

**③ 组内成员每次 render 全部重渲染。** `flowEntries` 每次 render 都产出新的 entry 对象，`ProcessGroupSeat` 的 `memo` 浅比较必然失败；`nodeSeat` 又是个每次 render 新建的对象字面量。两处一起导致：**任何一次无关状态变化，都会重渲染每个已结算组的每个成员行** —— 长会话里这就是看得见的闪。

- `nodeSeat` 改 `useMemo`（依赖全部字段）
- `ProcessGroupSeat` 用自定义比较：`entry.key` / `closed` / `members.length` / `summary` 两个计数 / `nodeSeat` 身份 / `deferFold` / `t`

**验证**：新增 `process-group-seat.client.spec.tsx` 5 条（开着的 Turn 保持平铺、关着的 Turn 且读者不在底部则折叠、**关着的 Turn 且读者贴底则保持展开**、折叠时 body 仍在 DOM、点击钉住覆盖锁存）。`ui-conversation` 全包 **13 failed / 652 passed**，失败集合与基线逐条相同；tsc 35；eslint 0。

**还没做的同类问题（如实记下）**：pending steering 气泡与 durable steering 行是**两个不同的 DOM 元素**（`ChatView.tsx:1381` 的 `PendingSteeringBubble` vs `ChatNodeSeat` → `MessageItem`），切换瞬间元素被替换。用户消息有 `UserSendFlow` 的 `rpc:` 稳定 key 跨越这一跳，steering 没有对应的统一 flow item。要彻底丝滑，得给 steering 做同样的稳定 flow key。

**补记：入场过渡撤掉了（学 DSH）。** 我一度给 pending steering / echo 气泡加了 `@starting-style` 淡入，也给 context 行加了从零高度的生长动画。核查 DSH 后撤回：

```bash
git grep -rn "@starting-style" -- "*.css"        # ui-chat 里 0 处（只有 ui-primitives / sidebar-right / desktop shell 用）
git grep -rn "transition:" -- ui-chat/src/**/*.css
# → ChatGroupSeat: margin-top 160ms   ← 折叠时的间距
# → ChatView:110    margin-top 160ms   ← 同一件事
# → RunningStatus 两条 keyframes
```

**DSH 的消息行没有入场动画**，是直接出现的。它之所以不跳，靠的是三件结构性的事：

1. `follow-growth.ts` 的 `shouldFollowContentGrowth`——内容在底部增长时重新贴底（XRK 已有这个函数，`ChatView.tsx:1055` 在用）；
2. 折叠用**间距过渡**（`margin-top 160ms`）而不是硬切；
3. `turnSpacer` 底部留白——折叠让出的空间先留白、再由后续内容长进去。

XRK 的折叠用 `grid-template-rows: 1fr ↔ 0fr` **本身就是高度过渡**，下方行跟着高度平滑移动，已经等价于 DSH 那条 `margin-top` 过渡，而且不需要把 flex `gap` 改成逐兄弟 `margin-top`（那是我上一版调研里为 `hidden="until-found"` 才需要的改造）。

所以结论：**删掉占位行本身就够了**，不需要给行加入场动画。加动画是拿视觉糖盖住结构问题。





#### 轮次轨道虚拟化的三个前置（未做）

DSH 只虚拟化 36 px 的轮次轨道，**不对消息行虚拟化**（与本仓 `ChatView.module.css:63-67` 的结论一致）。XRK 的 10 格「相机窗口」换成虚拟化需要：

1. `packages/client/web/src/platform.ts` 加 `@tanstack/react-virtual`（当前只有 `ui-trajectory` 私有依赖 `^3.14.9`，锁文件解析到 3.14.10）；否则两个包各打包一份虚拟化器，`observeElementOffset` 的 window 绑定互不知情。
2. 保留「会话最新 = 地板刻度」语义（`FLOOR_SKIP_PX`、`slideTurnRailWindow` 的 11 格设计是 XRK 特有，DSH 没有），虚拟化后要 pin 末项。
3. jsdom 里 `clientHeight/scrollHeight` 恒 0，`observeElementRect` 覆盖的 `placed` 永不成立、`scrollToFn` 全被吞 —— 现有轨道测试要注入 `initialRect`，否则会静默渲染 0 项。

#### 验证

- `packages/core/session`：**170 passed / 24 files**（含新增 `wal-shrink.test.ts` 3 条）。
- `packages/protocol` + `packages/session/session-projection`：**67 passed / 10 files**。
- `packages/server/face`：**153 files passed**（并发跑时曾出现 1 条 `session.create` flaky，隔离复跑即绿 —— 与本次改动无关）。
- `packages/client/ui-tool`：**265 passed**（基线 265）。
- `packages/client/ui-workspace`：132 passed / 8 failed —— **与基线同一批失败**（新增 4 个通过）。
- `packages/client/ui-plan` + `ui-trajectory` + `ui-conversation`：失败集合与基线逐条相同（21–29 条，来自工作树中并发修改 `ui-conversation/locales.ts` 的「插队中」文案断言），**新增失败 0**。
- 新增回归锁：`ui-workspace/tests/row-scope.client.spec.tsx`（行级渲染计数）、`core/session/tests/wal-shrink.test.ts`（WAL 回收）。

改动文件：`packages/core/session/src/{sqlite-store,repair-open-turn}.ts` + `tests/wal-shrink.test.ts`、`packages/session-format/src/sqlite-schema.ts` + 其测试、`packages/protocol/src/permission-knobs.ts`、`packages/session/session-projection/src/index.ts`、`packages/server/face/src/{runtime,handlers/session,adapt/history-paginate,path-allowlist,projections/list-checkpoint-cache}.ts`、`packages/client/ui-tool/**`、`packages/client/ui-workspace/**`、`packages/client/ui-plan/**`、`packages/client/ui-trajectory/**`、`packages/client/ui-conversation/**`、`packages/client/ui-primitives/src/Menu.tsx`。

---

## 2. S 组 · 存储层

### S1 ✅ `synchronous = FULL` → `NORMAL`

**证据**：`packages/core/session/src/sqlite-store.ts:370`
```ts
db.exec("PRAGMA synchronous = FULL");
```

**开销**：WAL + FULL 意味着**每次事务提交都 fsync WAL**。一个 turn 至少 4 次耐久边界（`user/message` / `turn/start` / `turn/end` / `command/*`，边界集合在 `sqlite-store.ts:718-723`），即每个 turn ≥4 次 fsync。杀软/机械盘下单次可达数 ms，流式期间 `tool/result` 边界也会触发。

**改法**：
1. 默认改 `PRAGMA synchronous = NORMAL`（WAL 下的标准推荐值，崩溃只丢最后一个未 checkpoint 的事务）。
2. 对「用户输入不能丢」这条红线，在写 `user/message` 的那个事务前临时 `PRAGMA synchronous = FULL`，事务后恢复 `NORMAL`。`PRAGMA synchronous` 不开启事务，可运行时切换，成本只有两次 pragma 调用（频率 = 每次用户发送）。
3. `journal_mode = DELETE` 的远程盘分支（`sqlite-journal.ts:24-42`）保持 FULL 不动。

**风险**：断电/强杀可能丢最后一条 `turn/end`。已有 `repairOpenTurnEvents`（`sqlite-store.ts:784`）能收拾 open turn，属于已覆盖路径。必须补一条崩溃注入测试。

**验证**：
- 写入吞吐：`events/s`（改前/改后对比，用一个 5,000 事件的合成 turn 压测）。
- 崩溃注入：写入中途 `process.kill(-9)`，重启后 `repairOpenTurnEvents` 恢复一致性、`user/message` 不丢。
- 现有 `packages/core/session/tests/**` 全绿。

**依赖**：无。**这是全文档最高 ROI 的单行改动。**

---

### S2 ✅ WAL 从不回收 → 显式 checkpoint + journal_size_limit

**证据**：全仓 grep `wal_checkpoint|journal_size_limit|wal_autocheckpoint|cache_size` **零命中**；`initSchema` 只设 `journal_mode` 和 `synchronous`（`sqlite-store.ts:368-370`）。`close()` 只做 `maybeVacuum`（`:1130-1143`）。

**开销（实测）**：WAL 534.9 MB。后果：
- 每次打开 DB 都要读/校验 535 MB 的 wal-index；
- 未 checkpoint 的页让读路径变慢（G 项全表扫描 603 ms 就包含这个因素）；
- 磁盘白占 535 MB（+ 归档库 82.8 MB）。

**改法**：
```ts
// initSchema 尾部
db.exec("PRAGMA wal_autocheckpoint = 1000");      // 4MB 页，显式声明
db.exec("PRAGMA journal_size_limit = 67108864");  // 64MB 上限
db.exec("PRAGMA cache_size = -65536");            // 64MB 页缓存（可选）
```
```ts
// close() 里，VACUUM 之前
try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* busy 时下次再试 */ }
```
另加一条：Host 启动后空闲 30s 做一次 `wal_checkpoint(TRUNCATE)`，防止长进程永不 close。
`journal_mode = DELETE` 分支跳过这些。

**风险**：checkpoint 会短暂持写锁；放在 `close()` 与空闲期是安全的。若当时有长读事务，`wal_checkpoint` 返回 busy，忽略即可（下次再试）。

**验证**：
- `sessions.db-wal` 文件大小：535 MB → ≤64 MB。
- 冷启动到首个 RPC 的时间。
- 现有 session 测试全绿。

**依赖**：无。**与 S1 同批做，一次回收 ~535 MB。**

---

### S3 ⚠️ 流式 chunk 双写：`assistant/chunk` 与 `text-chunks` 并存

**证据**：`assistant/chunk` 48,473 行 / 18.8 MB，`text-chunks` 22,856 行 / 22.6 MB，合计 **71,329 行 / 41 MB**。写入侧见 `sqlite-store.ts:617-636`（每条 `INSERT events` + `INSERT search_fts`，另有 `indexJoinedTextChunks` 再插一条聚合文本）。

**开销**：同一份 token 流存两遍；每行都触发一次 FTS trigram 更新（写放大）；打开会话时 71k 行要全部 `JSON.parse`（占 1.2 节 95 ms 的绝大部分）。

**改法（三选一，需产品决策）**：
- **A（推荐，兼容最好）**：保留 `assistant/chunk` 作为**唯一**流式真源，`text-chunks` 只在**压缩/归档**时生成聚合行；新会话不再写 `text-chunks`，旧数据保留（读路径已兼容两种）。
- **B（激进）**：流式期间只写内存，settle 时写一条 `assistant/message`；崩溃会丢未 settle 的 token（`repairOpenTurnEvents` 已有兜底）。
- **C（最小改动）**：给 chunk 行加 `packed` 打包（已有 `chunk-pack.ts`），把 N 条合并成 1 行。

**风险**：历史数据不可改写；检索（FTS）与「加载更早」的 delta 重建依赖 chunk 行，需确认 `dropSupersededStreamDeltas`（`history-paginate.ts:179-205`）在 A 方案下行为不变。

**验证**：新会话跑一个 2,000 chunk 的流式回合，对比 `events` 行数（应减半）；`session.search` 命中率回归；`loadOlder` 的 delta 重建测试。

**落地性**：⚠️ 需决策选 A/B/C。**A 最稳。**

---

### S4 ✅ `request/header` 全文落盘 → 只存摘要 + 引用

**证据**：`request/header` 1,319 行 / **134.7 MB**（42%）。最大单条 247 KB（`sess_mvbzeydl_ri2ft1` seq 665）。类型定义里它是完整 system prompt + 工具 schema + 上下文快照。

**开销**：每轮请求重写一遍完整 header，平均 102 KB/条。UI 从不渲染它（只在「请求详情」里按需展示）。这 135 MB 纯属存储 + 每次写盘的 IO。

**改法**：
1. 落盘时改存 `{ type:'request/header', hash, bytes, model, tools: names[], summary }`，完整 body 另存 `request-headers/<hash>.json.gz`（内容寻址，天然去重——同一 system prompt 只存一份）。
2. 读路径按需取（只有「请求详情」面板打开时才读文件）。
3. 旧数据不动，读路径兼容 `payload.body` 与 `payload.hash` 两种形态。

**风险**：`routeFromRequestHeader`（`session.ts:547-553`）从 header 倒扫路由信息，需保留 `model`/`provider` 字段在摘要里。`contextTimeline` 是否读 header 需确认（`units/context-timeline.ts` 只读 type/时间，静态看安全，**待确认**）。

**验证**：新会话 10 轮后，`request/header` 字节数应下降 ≥90%；`session.history` 的 header 相关字段回归；路由恢复测试（`routeFromRequestHeader` 单测）。

**收益（估算）**：135 MB → ~5 MB，DB 缩小约 18%。

---

### S5 🔗 `sessions` 表扩列，消灭侧栏 7 秒

**证据**：`sqlite-store.ts:1049-1063`（`listHints` 冷路径）、`:448-468`（`json_extract` 全扫）、`:470-475`（`SELECT MAX(ts) … WHERE session_id=?`）。

**开销（实测）**：205 会话冷刷新 **≈7.0 秒**（`MAX(ts)` 4.4s + `command/run` 2.6s）。

**改法**：
```sql
ALTER TABLE sessions ADD COLUMN last_ts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN has_turn_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN has_command_run INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sessions_last_ts ON sessions(last_ts DESC);
```
- 写入口只有一处（`writeRecord` / `flushPending`，`sqlite-store.ts:615-620`），在那里同事务 upsert 这四列。
- `SQLITE_SCHEMA_CURRENT` 从 3 升到 4（`packages/session-format/src/sqlite-schema.ts:13`），`migrateSqliteSchema` 加一条 backfill（183,982 行，一次性，实测全表扫 ~600 ms，可接受；放后台线程或启动时一次性完成）。
- `listHints` 改成 `SELECT id, last_ts, event_count, has_turn_start, has_command_run FROM sessions ORDER BY last_ts DESC`。

**风险**：迁移要一次性 backfill；旧 DB 首次打开会慢一次（~1s），需给出进度提示或延迟迁移。`sessions` 表当前只有 `id` 一列，扩列不影响主键。

**验证**：`session.list` SQL 次数从 N×3 降到 1；侧栏冷刷新 7.0 s → <50 ms；迁移前后 title/时间显示一致。

**收益**：侧栏从「等几秒」变「瞬时」。**这是用户最能立刻感知的一项。**

---

### S6 ⚠️ FTS5 trigram 索引策略

**证据**：`sqlite-store.ts:319-328` `tokenize = 'trigram'`；每条记录一次 `insertFts.run`（`:619`），另有 `indexJoinedTextChunks` 再插一条（`:622-636`）。FTS 表占 73,264 页 ≈ 300 MB 量级。

**开销**：trigram 对同段文本产生的 token 数是 unicode61 的约 3 倍，写入同步变慢；DB 体积主因之一。

**改法（需产品决策）**：
- **保留中文子串检索**：`tokenize='trigram'` 不变，但**只索引** `user/message`、`assistant/message`、`tool/result.content`，跳过 `text-chunks` 聚合行与 `request/header`。预计索引体积减半以上。
- **换 `unicode61 remove_diacritics 2`**：体积大降，但中文子串搜索退化为整词匹配（中文分词不友好）。**不推荐**，除非同时上 `LIKE '%q%'` 兜底。

**风险**：改 tokenizer 需要整表 rebuild（`rebuildFts` 已存在，`sqlite-store.ts:343-366`），183,982 行重建约数秒到数十秒；期间检索不可用。建议只在「只索引三类事件」这条上做，不动 tokenizer。

**验证**：DB 体积、`session.search` p50 延迟、固定 query 集的命中率回归。

---

### S7 ✅ VACUUM / 归档策略（**实测收益小，降为 P2**）

**证据**：freelist 5,619 页 = 22 MB；`maybeVacuum` 在 `close()` 里（`sqlite-store.ts:1130-1143`）。

**实测（在真实库副本上跑）**：

| 操作 | 结果 |
|---|---|
| `PRAGMA wal_checkpoint(TRUNCATE)` | WAL **534.9 MB → 0 MB**，272 ms |
| `VACUUM` | DB **745.1 → 727.3 MB**，**18.8 秒** |
| `freelist_count` | 3,349 页 → 0 |

**结论：VACUUM 只回收 18 MB，却要 18.8 秒**。DB 的 727 MB 是真实内容（payload 321 MB + FTS trigram 索引约 300 MB + 索引开销），不是碎片。
所以体积优化的主战场是 **S4（`request/header` 135 MB）** 和 **S6（FTS 只索引三类事件）**，VACUUM 只是收尾。

**改法（降级）**：
1. `close()` 顺序：`wal_checkpoint(TRUNCATE)` → `PRAGMA optimize` → 条件 `VACUUM`（仅当 freelist > 15% **且**距上次 VACUUM > 30 天，记在 `meta` 表）。18 秒的 VACUUM 不能每次退出都跑。
2. 归档库同样处理（`:511-521` 已创建两个 store）。
3. 超过 N 天且无 open turn 的会话，移到 `sessions-archive.db`（已有归档库，只需补搬迁逻辑）。

**风险**：`VACUUM` 需要 2× 磁盘临时空间（实测 745 MB 库要 ~1.5 GB 空闲）；VACUUM 期间阻塞写入，只能放 `close()` 或显式维护命令。

**验证**：`sessions.db` 体积、`freelist_count`、VACUUM 耗时。

---

## 3. O 组 · 打开会话链路

### O1 🔗 SQL 层 seq 下推（**P0，单点收益最大**）

**证据**：`packages/core/session/src/sqlite-store.ts:424-437`
```ts
const rows = db.prepare("SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC").all(id)
```
上层已经算好 `beforeSeq`/`maxMessages`（`packages/server/face/src/adapt/history-paginate.ts:110-151`），但 `readSessionEvents(store, sessionId)`（`packages/server/face/src/handlers/session.ts:484`）不传范围。

**开销（实测）**：6,505 行 = 47.3 ms SELECT + 95.2 ms JSON.parse；只看最后 50 条消息也要付全量代价。而尾部 200 行只要 **0.8 ms**。

**改法**：
1. `SessionStore` 接口加 `readEventRowsRange(id, fromSeq, toSeq?)` 与 `readEventRowsTail(id, limit)`。
2. `sessionHistory` 先 `readEventRowsTail(id, maxMessages * 4)`（50 条消息 × 4 倍冗余覆盖 group 前缀），在内存里跑 `paginateSessionHistory`；不足再往前迭代一页。
3. `snapshotEvents`（`seq.ts:80-98`）复用同一接口。

**风险**：
- packed `text-chunks` 行可能跨页截断 → 按 `ts0/dts` 判定并在页边界回退若干行。
- `seq` 是 1-based 绝对序号，`seqByEvent` / `baseSeq` 契约不变（`session.ts:895-899`）。
- 无 schema 迁移。

**验证**：埋点「cold open SQL 行数 / JSON.parse 次数 / 耗时」。目标：6,505 → ≤300 行；17.9 MB → ≤1 MB；p95 open ≤200 ms。

---

### O2 🔗 投影 snapshot 全量 fold + checkpoint 全量深拷贝

**证据**：`packages/server/face/src/projections/snapshot-keys.ts:64-66` 返回 15+2 个 key；`packages/session/session-projection/src/index.ts:255-270` `cellFor` 缺省就 `buildCell(def, events)` **从 seq 1 重放**；`:441-452` `checkpoint()` 对**全部**注册单元 `structuredClone(cell.state)`，无 key 过滤——而调用方只要 2 个 list-tier key（`list-checkpoint-cache.ts:37-46`）。

**开销（估算）**：17 × 6,505 ≈ **11 万次 `apply`**，再加 17 份 `structuredClone`（`contextTimeline.state` 含上千 node）。

**改法**：
1. `checkpoint(sessionId, keys?)` 支持 key 过滤，只 clone 被请求的单元。
2. 新增持久化表：
```sql
CREATE TABLE projection_checkpoints (
  session_id TEXT NOT NULL, key TEXT NOT NULL, ver INTEGER NOT NULL,
  seq INTEGER NOT NULL, val TEXT NOT NULL,
  PRIMARY KEY (session_id, key)
);
```
冷启时先 `restore(checkpoint, events, baseSeq)`（`index.ts:403-439` 已有），命中就跳过 fold。
3. `contextTimeline` 的 wire 层只发最近 50 个 node + `droppedNodes` 计数（`registry.ts:120` 已有字段）。

**风险**：`restore` 在版本不匹配时抛错（`index.ts:416-421`），升级 `stateVersion` 必须整表失效；`contextTimeline.stateVersion: 4`（`context-timeline.ts:300`）。

**验证**：`buildCell` 加计数器，冷开 `apply` 次数应从 11 万降到 ≤2 万；第二次 open 应为 0；`projection_checkpoints` 命中率。

---

### O3 🔗 `contextTimeline` 内部 O(n²)

**证据**：`packages/server/face/src/projections/units/context-timeline.ts:450` `nodes: [...next.nodes, node]`、`:477`、`:523` `nodes: [...withoutPrior, node]`（`:497` 先 `filter` 整个 nodes）、`:529-532` compaction 分支 `archive = [...next.archive, ...next.nodes.map(...)]`。

**开销（估算）**：1,500 个产 node 的事件 → 累计复制约 110 万元素 + 1,500 次全量 filter。是「打开大会话卡一下」的主要 CPU 项。

**改法**：
1. state 改可变数组 + 显式 `rev` 递增（`apply` 契约允许返回新 state 但内部数组可变，需在注释里放宽）。
2. `tool/result` 用 `Map<callId, index>` 定位替换，去掉 `filter`。
3. 加 `MAX_NODES`（如 400）滑窗 + `nodeCount` / `archiveCount` 累计，超出丢进 archive 摘要。

**风险**：`view()` 的 `nodes` 被 Context 面板计数（`:290-296`），裁剪需保留 `droppedNodes` 并让面板显示「N 项（已折叠 M）」。

**验证**：`apply` 总耗时、`nodes.length` 上界、面板计数与 `droppedNodes` 一致。

---

### O4 🔗 客户端 `replaceWindow` 全量重建 + 无时间切片

**证据**：`packages/client/runtime/src/client/sessions/conversation-assembler.ts:168-187`
```ts
this.contexts.clear(); ...; this.inputs.clear();
const sorted = [...entries].sort((l,r)=>l.event.seq-r.event.seq)
for (const entry of sorted) this.matchInput(entry)
```
`flush()` 的 replace 分支再对每个 context `buildNode` + `builder.replace(全量)`（`:282-303`）。

**开销**：一次 open 触发 `clear + sort + 逐事件 dispatch + 全量 view rebuild`，全在 React 渲染前的同一宏任务里 → 「白屏一下再闪出来」。

**改法**：
1. 单页 ≤300 事件时按 200 条切片，`scheduler.postTask` / `requestIdleCallback` 增量 `append`（`prepend` 已支持增量，`:223-248`），最后一次 `flush`。
2. 或先 `flush` 一屏（最后 30 条）+ 后台补齐。
3. `sort` 可省（入参本就按 seq 升序，Host `toWireHistoryEntry` 顺序产出）→ 换成 `assertOrdered` 断言。

**风险**：`replacePending` 语义（`:272-274`）与「窗口必须连续」不变式；切片期间 `liveBuffer` 要继续缓存（`session.ts:972-976` 已实现）。

**验证**：open → first paint 的 `performance.measure`；主线程 >50ms long task 数量。

---

### O5 ✅ 重复全扫（三处）

| 位置 | 现状 | 改法 |
|---|---|---|
| `packages/server/face/src/path-allowlist.ts:22-28` | 每次 open 全量扫 `path/allowlisted`，无「已水合」标记；调用点 `session.ts:488`、`runtime.ts:834`、`host/src/index.ts:1495` | 记 `primedLen: Map<sid, number>`，长度不变直接返回（抄 `wire-ids.ts:59-62` 的成熟写法） |
| `packages/core/session/src/repair-open-turn.ts:237-238` + `:149` | 无 open turn 也全扫；修复路径 `log() = [...events, ...out]` 反复整数组复制 → O(n²) | (a) 先查末行 type 快速否定（命中仍需全扫，保留语义）；(b) `log()` 惰性缓存，`out.length` 变化才重建 |
| `packages/server/face/src/adapt/wire-ids.ts:59-82` | 每次 evict 后 `clear()` 抹掉 `primedLen`，冷开重扫 | 与 O2 的 checkpoint 一起持久化 `count` 与已见 id 集 |

**验证**：第二次 open 时 `hydrate` 遍历次数应为 0；`primeFromLog` 遍历量为 0；`turnOutline.turn` 与 `wireIds.turn()` 全量对账测试。

---

### O6 ✅ 权限 knob 每次工具调用全量 fold

**证据**：`packages/server/host/src/index.ts:1476-1488`
```ts
pathAccessMode: () => { ... return pathAccessModeFromSandbox(effectiveSandboxMode(readSessionEvents(store, sessionId))) }
```
`packages/protocol/src/permission-knobs.ts:37-62` 是整日志 fold（`foldPermissionKnobs` / `effectiveApprovalPolicy`）。

**开销**：单 turn 里 N 次工具调用 → N × 6,505 次 `applyPermissionKnobEvent`；会话被 evict 时还附带一次全量 SQL。

**改法**：`permissions` projection unit 已是注册单元（`packages/server/face/src/projections/units/permissions.ts`，`install-defaults.ts:52`），`pathAccessMode` 改读 `projections.stateOf(sessionId, 'permissions')`；或 Host 侧缓存 `{seq, mode}`，只在 append 到 `*knob` 事件时失效。

**风险**：Host 可能先于 Face 运行（`runtime.ts:827-838` 已处理此序），需要 store-level 缓存兜底；`effectiveApprovalPolicy` 同样全扫，一并改。

**验证**：单 turn 的 `foldPermissionKnobs` 调用计数；每工具调用耗时。

---

### O7 ✅ `listProjectionCache.remember` 同步重写整个 JSON

**证据**：`packages/server/face/src/projections/list-checkpoint-cache.ts:120-132`（`remember` 内直接 `flush()`）→ `:90-110` `writeFileSync(tmp)` + `renameSync`，每次序列化**全部**会话行。

**开销**：每打开一次会话写一次盘，加在 open 的尾延迟上；会话越多单次 JSON 越大。

**改法**：`remember` 只标 dirty；flush 改 debounce（`setTimeout(500)`）+ 原子写；或改 append-only `projection-list-cache.jsonl`（每行一条 `{id, asOfSeq, checkpoint}`）。

**风险**：崩溃丢最后几百 ms → 冷列表退回 `listHints`（`session.ts:410-424` 已有降级），不丢数据。

**验证**：open 的 RPC 尾延迟；`projection-list-cache.json` 写次数从「每次 open」降到「每 500ms 一次」。

---

### O8 ⚠️ open 时 gap 检测可能拉两次

**证据**：`packages/client/runtime/src/client/sessions/session.ts:869-875`
```ts
if (this.subscribedLastSeq !== null && tailSeq !== null && this.subscribedLastSeq > tailSeq) {
  result = (await this.history({ maxMessages: PAGE_MESSAGES })).result
```

**开销**：订阅先于 history 返回时（大会话几乎必然），第二次全量 history——**open 的 2× 成本**。

**改法**：第二次请求带 `untilSeq: this.subscribedLastSeq` 提示；或新增轻量 RPC `session.eventsSince(seq)` 只拉增量。

**风险**：窗口连续性不变式（`:967-979` 注释）依赖单一 `history` 页；新增 RPC 必须走同一 `toWireHistoryEntry` 适配，否则 wire id 会漂。

**验证**：带订阅竞态的 open 用例断言 `sessions.history` 只调 1 次。

---

### O9 ✅ `history-paginate` 的多余全量扫描

**证据**：`packages/server/face/src/adapt/history-paginate.ts:123-128`
```ts
for (let i = 0; i < events.length; i++) { if (eventSeq(i) < beforeSeq) windowEnd = i + 1; else break }
const window = events.slice(0, windowEnd)
```
`beforeSeq` 已知时应直接 `windowEnd = beforeSeq - 1`；`:305` 还 `events.map(estimateHistoryEventChars)` 全量。

**改法**：`windowEnd = Math.min(Math.max(beforeSeq - 1, 0), events.length)`；`sizes` 惰性计算（先粗估 `events.length * 64`）。

**风险**：`beforeSeq` 可能 > `events.length` 或 ≤0，需 clamp（`fixture.client.spec.ts:132` 已有 `beforeSeq:-5` 用例）。

**验证**：loadOlder CPU；`beforeSeq:-5` / `>len` 回归测试不变。

---

### O10 ✅ `flushPending` 线性扫全 pending 队列

**证据**：`packages/core/session/src/sqlite-store.ts:653-662`（按会话过滤需全队列扫）。

**改法**：`pending` 改 `Map<sessionId, PendingEvent[]>` + 全局插入序 `seq` 字段；`flushPending(id)` 直接取该 session 队列。

**风险**：`flushPending()` 无参时要求跨会话顺序，用 `seq` 排序保留。

**验证**：子代理 fan-out 场景的 flush 耗时；pending 队列长度上界。

---

### O11 ✅ `initSchema` 每次打开都跑 DDL

**证据**：`sqlite-store.ts:405-411`：`stored >= SCHEMA_VERSION` 时仍 `ensureTables()` + `ensureFts()`（含 `CREATE VIRTUAL TABLE`），两个 store 各跑一遍。

**改法**：`stored === SCHEMA_VERSION` 直接 return；保留 `XRK_SQLITE_VERIFY_SCHEMA=1` 走旧路径。

**风险**：手工删表/DB 损坏时少一层自愈——用环境变量兜底。

**验证**：Host 启动到首个 RPC 的时间；DDL 执行次数为 0。

---

## 4. R 组 · React 渲染

### R1 🔗 对话流零窗口化（**P0**）

**证据**：`ChatView.tsx:1168-1189` 逐节点 `columnRows.push(<ChatNodeSeat …/>)`，`:1309-1329` 全量渲染；`ChatView.module.css:63-70` 明确写着
> `Do NOT use content-visibility:auto here — Chromium skip/unskip has painted durable ghost copies of turn-tail footers`

即：**唯一的伪虚拟化被移除后没有替代方案**，所有行常驻 DOM。`MessageItem.module.css:104` 还留着过时注释自相矛盾。

**开销**：一次「加载更早」后整个窗口的 Markdown / 代码块 / 图片行全部挂载；首帧成本、内存、每次结构性变更都随行数线性增长。这是「越用越卡」的主因之一。

**改法**（复用仓内已有能力，不新写一套）：
1. 复用 `packages/client/ui-trajectory/src/client/trajectory-virtual-rows.ts` + `TrajectoryTable.tsx:136` 的 `useStableVirtualRowStructure`（稳定行结构 + 高度缓存）。
2. 把 `columnRef` 内的 `columnRows` 包一层虚拟窗口，mounted 区间 = 视口 ± 一屏。
3. **强制挂载白名单**：`data-live` 行（当前流式行）、`turn-tail` 行、正在展开的折叠面板。
4. 行高用 `ResizeObserver` 缓存到 `Map<anchorKey, height>`，折叠面板展开时 `measureElement` 失效重测。

**风险**：`follow-growth.ts` / `flowTop` 的贴底数学（`ChatView.tsx:808-1010`）依赖真实 DOM 高度，虚拟化后必须用 `measureElement` 的估算高度参与计算，贴底逻辑要重写为「按估算总高滚动」。

**验证**：400 行 fixture（20 代码块 + 20 图）测 mount→可交互时间与 DOM 节点数（改后应恒定在窗口大小）；滚动 long task 数；新增断言「只挂载窗口内 `data-chat-anchor-key` 行」。

---

### R2 ✅ 工具行每次渲染 3–4 次 `JSON.parse` + 深拷贝 + 全量 pretty-print（**最重的叶子节点**）

**证据**：
- `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:318` `return JSON.stringify(redactArgsValue(parsed), null, 2)`
- 同文件 `:394` `body: deriveBody(variant, argsRaw)` —— **无条件求值**
- `:224` `:253` `:310` 三处各自 `parseArgs(argsRaw)`
- `packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx:42` 无 `memo`，`:45` 每次渲染跑 `toolRowModel`

**开销**：`write_file` / `edit` / `present` 的 `argsRaw` 常是几十到几百 KB。每次该行渲染：parse 3–4 遍 + `redactArgsValue` 递归复制整棵树 + `JSON.stringify(..., null, 2)` 出一份更大的字符串——而 `body` 只在展开时用得到。流式期间 args 每变一次就重做一遍。

**改法**：
1. `GenericToolCard` 加 `memo`，`model` 用 `useMemo([toolName, block, cwd, home])`。
2. `toolRowModel` 顶部只 `parseArgs` 一次，结果传给 `deriveSummary` / `deriveFilePath`。
3. `body` 改惰性：`getBody: () => deriveBody(...)`，由 `ToolRow` 在 `open === true` 时才调用。
4. `redactArgsValue` 与 `JSON.stringify` 各加一层 `useMemo`（键 `argsRaw`）。
5. 长期：Host 侧把「已 redact 的 pretty JSON」随 `callView` 下发，客户端零解析。

**验证**：同一 `block` 连续两次 render 统计 `JSON.parse` 次数（改前 ≥3/行，改后 1/行且只在 `argsRaw` 变化时）；300 KB args fixture 的单行 render 自耗时（改前 10 ms 量级）；单测 spy 断言折叠状态不调用 `JSON.stringify`。

---

### R3 ✅ 侧栏整树订阅 + 行非 memo

**证据**：`packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx:296` / `:622` / `:750` 三处 `useSessions(s => s)`（无选择器无 equality）；`rows/Rows.tsx:511` `SessionNodeItem` 无 `memo`；`WorkspaceBrowser.tsx:695-713` 每行内联构造 `drag={{start,hover,drop,end}}`；`:674` 渲染期读 `Date.now()`。

**开销**：任一 session 的 title / running 翻转 / catalog activity 变化 → 整张列表重渲染；`deriveFlat` 重新排序全部会话；每行重建菜单数组 + 4 个闭包。

**改法**：
1. `useSessions` 只选需要的切片；行内用 `SessionRow` 自带窄订阅（`s.byId[id]`）。
2. `SessionNodeItem` / `ProjectRowItem` 包 `memo`。
3. `drag` 四个回调上提到行外按 `node.id` 记忆（`useCallback` + `useRef` 分发表，或容器事件委托）。
4. `now` 改为按分钟 tick 的 store 值。
5. `sessionMenuItems` 用 `useMemo`，图标提取为模块常量（`Rows.tsx:540-550`）。

**验证**：在 `SessionNodeItem` 打渲染计数，触发「另一个 session 的 running 翻转」，改后应只有该行 + 容器重渲染；1000 会话下 `deriveFlat` 计时。

---

### R4 ✅ `PresenceBall` 10 个 uSES + 每次渲染重建 `MutationObserver`

**证据**：`packages/client/ui-plan/src/client/PresenceBall.tsx:39-43`（`:47` `:55` `:63` `:71` `:79` `:87` `:95` `:103` 同构，共 10 处）内联 `subscribe` 箭头；`:111-122` `useChromeDark` 在 inline subscribe 里 `new MutationObserver(onStoreChange)` + `observe(document.body, …)`；`:717-720` 每 `PHASE_MS = 8000` 一次 `setPhase`。

**开销**：uSES 以 `subscribe` 引用为 effect 依赖 → **每次渲染把这 10 个订阅全部退订再订阅**，并把 `body` 上的 `MutationObserver` 断开重建一次（每 8 秒必发生）。

**改法**：
1. 仿 `packages/client/web-react/src/scoped-slots.tsx:255-270` 的 `localeSubscriptionCache`，用 `WeakMap<store, {subscribe}>` 缓存稳定引用。
2. 10 个字段合并成一次订阅：`useSyncExternalStore(subscribe, readPresencePrefs, readPresencePrefs)`，`readPresencePrefs` 内部返回指纹缓存的同一对象（可抄 `ui-primitives/src/workspace-changes-turns.ts:68`）。
3. `useChromeDark` 提到模块级单例（一个 document 只需一个 observer）。

**验证**：给 `subscribe` 打计数——改前每次 PresenceBall 渲染 +10 subscribe / +1 MutationObserver 构造，改后 0。

---

### R5 ✅ `ChatView` 每次渲染重建 `chatRows` 并多趟扫描（未 memo）

**证据**：`ChatView.tsx:612` `const chatRows = [...nodeStore.values()]`；`:613-616` `collectUserShapedSeqs(chatRows.filter(...))`；`:617-620` `.some(...)`；`:625` `hasLiveAgentWork`；`:637-642` 两次 `order.slice().filter(...)`；`:643-657` 又一次反向全扫。全部不在 `useMemo` 里。

**实测校准**：我用真实 3,813 节点跑了这套派生（`.tmp/bench-chatview.mjs`），**单次 ≈0.2 ms**——因为 `isOpenerDuplicateSteer` 对非 steering 行立即返回。所以它**不是**平方级灾难，但确实是每次渲染的 O(n) 固定税，且随窗口线性增长。

**改法**：把 `chatRows` / `userSeqs` / `hasUserOpener` / `bodyOrder` / `trailingSteerOrder` / `lastDurable` 收进一个 `useMemo`，依赖 `[order, nodeStore, latestTurn, agentLive, pendingInputs]`；`isOpenerDuplicateSteer` 预计算 `userTextBySeq` 索引。

**验证**：400 行 + 3 steering 会话里统计 `humanBubbleText` 调用次数；profiler 对比结构性变更帧耗时。

---

### R6 ✅ `InputBar.deliveryBusy` 选择器每次快照全量扫描

**证据**：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:77-83`
```ts
useSession(s => { if (!(s.running ?? false)) return false; return composerDeliveryBusy(true, collectUserShapedSeqs([...s.chat.nodes.values()], latestTurnNumber(s.chat.timeline))) })
```

**开销**：uSES 每次 store 通知都执行选择器（不管是否重渲染）。流式期间约 20fps，`running === true` 时每次都 `[...nodes.values()]` + 全扫，只为得出一个布尔值。代码注释（`:75-76`）已承认这个成本。

**改法**：给 `ChatSnapshot` 加 `hasUserShapedSeq` 指纹（在 `MutableTurnNavigationIndex` 维护「最近 user 序」），组件侧只读 O(1) 标量。

**验证**：`collectUserShapedSeqs` 加计数器，跑 3 分钟流式回合：改前 ≈ 绘制帧数，改后只在结构性变化时调用；Ctrl+Enter 插队 latch 行为不变。

---

### R7 ✅ `ConversationSession` 为一次 mount seed 订阅整个 input store

**证据**：`ConversationSession.tsx:183` `const inputState = useInput(s => s)`；`:188-194` 只在 mount effect 里用一次 `inputState.draft`，deps 钉成 `[inputActions]`。

**开销**：视图外壳在**每次按键**都重渲染，并把 `renderSlot('conversation.view', …)` 一起带进去。

**改法**：删掉订阅，mount effect 里改用 `useInput.getSnapshot?.()` pull；或下沉到 `InputBar`；最少改成 `useInput(s => s.draft)`。

**验证**：输入 20 个字符，外壳渲染次数应从 ≈20 降到 0。

---

### R8 ✅ `DetailsPanel` 渲染期 `JSON.parse` + `JSON.stringify`

**证据**：`DetailsPanel.tsx:49-56` `pretty(raw) = JSON.stringify(JSON.parse(raw), null, 2)`；`:103` JSX 内直接 `<CodeBlock code={pretty(material.argsRaw)} … />`；`:59-64` / `:117` 结果块逐块 stringify。

**改法**：`useMemo` 缓存 `prettyArgs` 与 `rawResultText`（键为 `argsRaw` / `material`）。

**验证**：300 KB args 打开详情面板，render 自耗时（改前 >15 ms，改后 <1 ms）；单测 spy 调用次数。

---

### R9 ⚠️ 连接层每帧同步 `JSON.parse` + 两次 zod 校验

**证据**：`packages/client/connection/src/client/web-api-client.ts:88-89`
```ts
full = serverRequestSchema.parse(JSON.parse(event.data)); frame = frameSchema.parse(full.payload)
```
SSE 侧 `packages/stubs/xrk-host-apiproxy/src/fetch/client.ts:489-490` 同构。

**开销**：每个 token delta、每个 tool 进度都走完整 zod 校验；大帧（长 thinking、工具大输出）几十 ms 直接吃掉一帧。

**改法**：流式热帧只校验判别字段（`type` / `rpcId`），深度校验延到 durable 边界或 `requestIdleCallback`；或把 mux 帧解析下放 Worker。

**验证**：200 KB thinking 帧连发 200 帧，测 long task 总数与 `message` 处理总耗时。**待确认**：真实帧大小分布需抓一次回放。

---

### R10 ✅ 历史图片无懒加载

**证据**：`packages/client/ui-attachment/src/client/MessageImage.tsx:157-164` 挂载即 `load(attachment)`，无 `IntersectionObserver`、无 `loading="lazy"`；`:235-243` `ImageGallery` 全量 `images.map`。

**改法**：外包可见性门（`IntersectionObserver` + `rootMargin:'200px'`）或给 `<img>` 加 `loading="lazy"` + `decoding="async"`；进入视口前只画缓存 URL 或占位框；`ImageGallery` 超过 N 张按需挂载。

**验证**：40 张图的会话，Network 首帧请求数从 40 降到可见数。

---

## 5. F 组 · 闪动与滚动

### F1 🔗 折叠行「直接卸载」→ 闪动 + 阅读位置跳

**证据**：`packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts:204`
```ts
.filter(node => node.visibility === 'visible')
```
行直接消失，没有零高盒子、没有折叠动效、没有滚动补偿。`follow-growth.ts:8-16` 只有「增长时是否贴底」一个判定；`ChatView.tsx:1001-1013` 只在 `ResizeObserver` 里 `scrollTop = scrollHeight`。

对照 DSH：`ui-chat/src/client/chat/flow-motion.ts:1-16,36-64`（`InputFoldDriver.begin/prepare/frame/finish`：先留出滚动空间 → 改盒 → 落底），`ChatNodeSeat.tsx:12` `hiddenOrCollapsing`，`ui-chat/README.zh.md:145`「每一批收起行与滚动容器在同一个帧时钟上推进」。

**改法**：
1. `chat-snapshot-builder.ts` 不再过滤，给行打 `data-chat-flow-hidden`。
2. 行容器渲染 `hidden="until-found"`（保留零高盒子 + 浏览器 Ctrl+F 可搜到 + `beforematch` 可展开）。
3. 移植 `flow-motion.ts` 的批次驱动到 `ChatView`：一批收起/展开在同一帧时钟推进，差额保留为底部空间。
4. 间距改用 `:not([hidden]) ~ :not([hidden])`（照 DSH `ChatView.module.css:77-80`）。
5. 删掉 `use-post-stream-live.ts` 的 480 ms 宽限补丁——隐藏盒子不参与 paint containment，ghost paint 的根因消失。

**风险**：`hidden="until-found"` 在旧版 Electron 需确认支持（Chromium 102+，当前桌面版应满足，**待确认**）。折叠动效与 `content-visibility` 的 ghost paint 是两回事，不要混。

**验证**：折叠一个长过程组，测 `scrollTop` 漂移（应 <1px）；Ctrl+F 搜折叠内容能命中并自动展开；录制 60fps 视频看是否闪。

---

### F2 ✅ 滚动热路径每帧多次 `elementsFromPoint` + 全量 rect

**证据**：`ChatView.tsx:933-971` 每个 scroll 事件都调 `scrollPosition(local, el)`；`:127-156` `pagingAnchor` 最多 4 次 `document.elementsFromPoint` + 全量 `querySelectorAll('[data-chat-anchor-key]')` + 逐行 `getBoundingClientRect()`；`:102-118` `turnAtLine` 又一次命中测试；`:780-790` 只有 `syncActiveTurn` 被 rAF 合并，`scrollPosition` 没有。

对照 DSH：`use-chat-viewport.ts:50-57`、`use-chat-reading.ts:7-8`（`FOLLOW_THRESHOLD=24`、`SCROLL_SAMPLE_INTERVAL_MS=500`）、`README.zh.md:169`「不做命中测试或按几何位置搜索」。

**改法**：
1. `scrollPosition` 纳入现有 `activeFrameRef` 的 rAF 合并（一次滚动帧只算一次锚点）。
2. `pagingAnchor` 改为「按 `order` 顺序找第一个有 `data-chat-anchor-key` 且 `offsetParent !== null` 的行」。
3. 锚点与 `chatScroll.save` 挪到 `scrollend` + 500 ms 采样定时器。
4. `elementsFromPoint` 采样点从 4 降到 2。

**验证**：400 行 fixture 做 5 秒惯性滚动，scroll 处理平均耗时 <8 ms；long task 数为 0。

---

### F3 🔗 内外层滚动跟随不统一

**证据**：`ChatView.tsx:991-1032` 是唯一 follow 实现 + 一个 `ResizeObserver`；`ChatView.module.css:185-208` 只有外层 `toBottomSlot`。内层限高滚动区（过程组、终端输出）没有跟随与边缘渐隐。

对照 DSH：`use-scroll-follow.ts`、`use-process-scroll.ts`、`use-chat-scroll.ts:50-51` 有明确的「外层跟随 × 小组跟随」组合表。

**改法**：抽 `use-scroll-follow.ts`（控制器 + `scrollMetrics`），先把 `ChatView` 的 `toBottom` / `follow-growth` 换过去；再给限高过程组/终端块各挂一个控制器。

**验证**：外层跟随 + 内层不跟 / 内层跟 + 外层不动 等 4 种组合的手动矩阵。

---

## 6. U 组 · 交互能力（对照 DSH）

> 这一组是用户说的「交互反人类」的主要来源。DSH 已把这些问题做成独立服务，可以逐个移植。

### U1 🔗 右栏是空壳（最大能力缺口）

**证据**：`ui-conversation/README.zh.md:61`「右列 Detail 面板已降级 — `ChatViewInjected.openDetails` 为空操作」；`ui-layout/README.zh.md:5,21` 三栏固定、details 关闭到零宽；`grep sidebarRight|sidebar-right` 全仓 **0 命中**；`ui-sidebar/src/client/SidebarRoot.tsx` 只有左栏。

DSH：`ui-dockkit`（分裂树 + 撤销/重做 + 浮窗 + WAI-ARIA tabs）、`ui-sidebar-right`（`ctx.sidebarRight` + Tab 域）、`ui-sidebar-browser` / `-terminal` / `-documentpreview`。

**改法（两步走）**：
1. **纯前端部分**：照 `ui-dockkit` 的两层结构（无 DOM 的 `applyOp`/`Sequencer` + 组件层）做 dock 引擎 + tab 注册表，右栏从零宽空壳改成可开合 tab 容器。
2. **逐个接 tab**：`documentpreview` 先做（只依赖现有 `workspaces.openPath` + 读文件）；`browser` / `terminal` 需要 host 协议（`sidebar://` 路由、`<webview>`/BrowserView、terminal controller）。

**风险**：L 级工作量；`browser`/`terminal` 纯前端做不出来。

**验证**：右栏可开合、tab 可拖拽分裂、刷新后恢复布局。

---

### U2 ✅ 正文链接无人接管（Desktop 下点链接会把应用导航走）

**证据**：`packages/client/ui-primitives/src/markdown/render.tsx:441-459` `renderSafeLink` 只做 `sanitizeUrl` + 直出 `<a href target=_blank>`；`grep openExternalLink|onLinkClick` 在 `packages/client` **0 命中**。

DSH：`ui-chat/src/client/chat/ChatView.tsx:40,64` `MarkdownDelegateProvider` + `openExternalLink`；`ui-chat/src/client/settings/LinkOpeningRow.tsx` 提供「应用内侧栏（默认）/ 默认浏览器」设置。

**改法**：给 `ConversationRoot`/`ChatView` 注入 `openExternalLink`，`MarkdownText` 加 `onLinkClick` 委托（`preventDefault`）；桌面走 `host.openExternal`。

**验证**：点击外链不导航主窗口；`#L24` / `#L24-L30` 行定位走文件标签。

---

### U3 ✅ 选中一段回复没有浮动操作

**证据**：`grep getSelection|pointerup|contextmenu` 在 `ui-conversation/src/client` 只命中输入框选区与 `ConversationRoot.tsx:165` 的 pointerup。

DSH：`ui-chat/src/client/chat/text-interaction.ts:1-45`（`available()` 逐祖先检查 `hidden/inert/data-text-interaction-exclude`）、`text-selection.ts`。

**改法**：新建 `ui-conversation/src/client/chat/text-interaction.ts` 照搬可视性判定 + portal 定位；动作先给「复制」和「引用」（`inputActions.insertText` 到草稿，`input/contract.ts:123` 已有落点）；给 `MessageItem` / `AssistantMarkdown` 正文容器加 `data-text-interaction-source`。

**验证**：选中文本 → 浮层出现且不被 composer 遮挡；「引用」把文本插入草稿。

---

### U4 ✅ 用户把 token/API key 贴进对话，界面原样显示

**证据**：`grep secret|credential.*mask` 在 `packages/client` 只命中设置页的 `SecretField`（`ui-settings-plugins/src/client/fields.tsx`）。聊天正文无遮蔽。

DSH：`ui-secret-mask/README.zh.md:12,28`——已发送用户文本里识别到的凭据，前 8 位可见其余 `*`，每条交互消息一个眼睛控件逐值展开；只改显示，复制/模型输入不动。

**改法**：新建 `packages/client/ui-secret-mask`，导出 `maskSecrets(text)` 与 `<MaskedText>`；在 `MessageItem` 用户气泡、`queue/QueueDock.tsx`、`InputBar` 回显三处套用；复制与 `aria-live` 保持原文。

**验证**：贴一个 `sk-…` 到对话，气泡显示 `sk-abc12********`，点眼睛展开原文，复制得到原文。

---

### U5 🔗 快捷键只有 7 条硬编码 + localStorage

**证据**：`packages/client/ui-layout/src/client/shell-shortcuts.ts:11-19`（`ShellShortcutId` 七项：`keybinds.openPanel` / `composer.submit|newline` / `layout.toggleSidebar|toggleDetails|prevSubagent|nextSubagent`）；`:1-8` 注释自认是 Hermes/DSH 的 diff-only 简化版；`grep ctx.shortcuts` **0 命中**。

DSH：`packages/client/shortcuts/README.zh.md:12,30`（插件注册命令、按平台声明默认键位、拒绝重复 id/冲突、随插件卸载移除）；`ui-shortcuts/README.zh.md:12,28`（`Mod+/` 速查窗，可搜索/录制/清除/恢复）。

**改法**：新建 `packages/client/shortcuts`（`ctx.shortcuts.register({id, name, defaults:{desktop:{macos,windows},web:{…}}, run})`，冲突抛错）；`shell-shortcuts.ts` 七条改为注册方；`ShortcutsPanel` 从 `ui-primitives` 提升为 `ui-shortcuts` 的 `Mod+/` 单实例弹窗，数据源换成服务目录。

**验证**：`Mod+/` 打开速查、搜索、改键、冲突报错、插件卸载后命令消失。

---

### U6 ✅ 焦点栈与键盘导航各写一遍

**证据**：`ui-primitives/src/Modal.tsx:104-136` 自己算 focus stops；`ContextMenu.tsx:180,217,226-237` 自己存 `restore` 再 `restore.focus()`；`Menu.tsx:321,358` 只有 `role="menu"`，**无方向键处理**（`grep ArrowUp|ArrowDown` 在 `ui-primitives/src` 只命中 `ContextMenu`/`JsonTree`）。

DSH：`ui-primitives/src/focus.ts:3`（`navigationKeys`）、`useModalLayer.ts:8,72`（modal/menu 层栈，Esc/Tab 由栈顶处理）、`Menu.tsx:401-411`（`ArrowDown/ArrowUp/Home/End` 循环）。

**改法**：加 `useModalLayer`（栈 + 顶层处理 Esc/Tab）与 `navigationKeys`；`Modal`/`ContextMenu`/`Menu` 全部改挂栈；给 `Menu` 补 WAI-ARIA menu 的方向键/Home/End/回车。

**验证**：嵌套弹层（菜单里开 dialog）Esc 只关最上层；菜单方向键可循环。

---

### U7 🔗 轮次轨道只有 10 格「相机窗口」

**证据**：`packages/client/ui-conversation/src/client/chat/turn-rail-items.ts:33` `TURN_RAIL_WINDOW = 10`、`:128-149` `slideTurnRailWindow`；`TurnNavigator.tsx:220-253` 只渲染窗口内刻度；`:284-296` 注释自认「长会话每 commit 重建数百个刻度」，只能靠 `memo` 兜。

DSH：`ui-chat/src/client/chat/TurnNavigator.tsx:6,110-120,166-167` 用 `@tanstack/react-virtual` 渲染**全部**轮次（`directDomUpdates` + `useScrollendEvent` + `rangeExtractor` 保留焦点相邻项）。

**改法**：删 `slideTurnRailWindow`，`TurnNavigator` 改 `useVirtualizer({count, estimateSize: () => TURN_SPACING_PX, getItemKey: i => items[i].turn, rangeExtractor})`；`itemAtPointer` 改用 `virtualizer.getVirtualItems()` 定位。

**前置**：B1（平台共享模块表加 `@tanstack/react-virtual`）。

**验证**：1,000 轮会话，轨道可连续滚动到底、DOM 刻度数恒定、拖动不跳格。

---

### U8 ⚠️ 只有「已安装插件」管理，没有「发现/市场」

**证据**：`ui-settings-plugin-inventory/README.zh.md:5-7` 只有安装可选 npm 源、更新/重载/停用/启用/删除/打开目录；`ui-settings-plugins/README.zh.md:9,15` 已有 `settings.plugins.tab` slot（正好是落点）。

DSH：`ui-plugin-market/README.zh.md:12`（索引源管理、跨索引搜索、分类/标签筛选、排序、详情页安装）。

**改法**：先做客户端半个——`settings.plugins.tab` 加「发现」tab，读一个 `index.json`（条目 schema 对齐 DSH），安装复用现有 inventory 的 install 调用；索引服务后续再补。

**验证**：搜索/筛选/安装/详情页 Markdown 渲染。

---

### U9 🔗 平台共享模块表缺 `@tanstack/react-virtual`

**证据**：`packages/client/web/src/platform.ts:8-14` 里是 `web-react`/`schema-form`，无虚拟化库；`grep react-virtual` 全仓只有 `ui-trajectory/src/client/TrajectoryTable.tsx:5` 与 `ui-trajectory/package.json:45`（`^3.14.9`，非 pin）。

DSH：`packages/client/web/src/platform.ts:8-15` 把 `zod`、`@tanstack/react-virtual`、`store`、`ui-dockkit` 冻结进 `PLATFORM_MODULES`。

**改法**：`platform.ts` 加 `'@tanstack/react-virtual'`（pin `3.14.10`），同步 `seed.ts` 外部表与 Vite alias；`ui-trajectory` 改 peer 依赖，避免打包第二份。

**验证**：插件 bundle 里不再内联虚拟化库；`ui-trajectory` 与 `ChatView` 共用同一实例。

---

## 7. L 组 · 内存无界保留

> 逐个查过所有 `addEventListener` / `ResizeObserver` / `setInterval` / `rAF` / `AbortController` / `WebSocket` / `Blob URL` 的清理——**清理都是完整的**。真正的无界保留只有下面三处。

### L1 ✅ `TrajectoryView` 渲染期写模块级 Map，永不释放

**证据**：`packages/client/ui-trajectory/src/client/TrajectoryView.tsx:34-37` `const trajectoryPaint = new Map<string, {turns; lastIndex}>()`；`:279-281` 在**组件函数体内** `trajectoryPaint.set(liveSessionId, finalized)`；全仓只有这三处引用，**无任何 delete/clear**。

**开销**：每打开过一个会话的 Trajectory，就把该会话全部 turn/cell（含消息正文、工具 args/output 引用）钉在模块级 Map，生命周期 = 整个进程。**这是本仓唯一会随使用线性增长的真实泄露点**。另外渲染期写模块状态在 StrictMode/并发渲染下不纯。

**改法**：`useMemo` 计算 + `useEffect` 写入按 `liveSessionId` 有上限的 LRU（最多 3 个）；`TrajectoryView` 卸载时 `trajectoryPaint.delete(liveSessionId)`。

**验证**：连续打开 20 个不同 session 的 Trajectory，`usedJSHeapSize` 应回到基线；断言 `trajectoryPaint.size <= 3`。

---

### L2 ✅ `OverviewChangesPanel` 的 `diffPaint` 永久缓存

**证据**：`packages/client/ui-plan/src/client/OverviewChangesPanel.tsx:22` `const diffPaint = new Map<string, WorkspaceFileDiff | null>()`；`:209-217` `paintKey = \`${sessionId}\0${turnSeq}\0${activeFilePath}\`` → `set`；无清理。

**改法**：加容量上限 + LRU（32 条），或会话切换时按 `sessionId` 前缀清理（挂在 `releaseSessionImages` 那类 disposer 旁）。

**验证**：切 10 会话 × 每会话 5 个文件 diff，Map size 有上限。

---

### L3 ✅ `ReasoningRow.expandedByKey` 无上限

**证据**：`packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx:10` `const expandedByKey = new Map<string, boolean>()`；`:70` 只 `set`，无 delete/clear。

**改法**：超过 200 条删最早。

**验证**：断言 `expandedByKey.size <= 200`。

---

### L4 ✅ `ReasoningRow` 流式期整段重渲染

**证据**：`ReasoningRow.tsx:55-57` `bodyText = running && text.length > LIVE_THINK_CHARS ? text.slice(...) : text`；`:96` `<div className={css.thinkBody}>{bodyText}</div>`。

**开销**：Think 展开时每帧把最多 12k 字符作为单个文本节点 diff。

**改法**：尾部窗口 + 前缀一次性冻结（`markdown/incremental.ts` 已有尾块冻结能力，纯文本走 plain 通道）。

**验证**：30k 字 reasoning 流式展开，单帧脚本耗时稳定在 2–3 ms。

---

## 8. B 组 · 包体与启动

### B1 🔗 平台共享模块表（见 U9）
加 `@tanstack/react-virtual` + pin，是 R1/U7 的前置。

### B2 ⚠️ `ui-conversation` 单包 1.5 MB

**证据**：实测 raw 1,518 KB / br 273 KB，是首屏最大单点；包内同时含 Chat 视图、composer、skeleton、settings 行。

**改法（按收益排序）**：
1. 把 `settings/EnterBehaviorRow`、`skeleton/DetailsPanel` 等非首屏组件改为 `lazy()` 动态 import（需要插件 bundle 支持 code splitting，**待确认**现有 `bundle-client-js.mjs` 是否产出多 chunk）。
2. 把 Markdown/代码高亮的语法包按需加载（当前 `assets/langs/*` 已分离，但 `cpp` 778 KB / `ruby` 416 KB 是否首屏加载需确认）。
3. 长期：按 DSH 拆包（`ui-chat` 独立、`ui-conversation` 只留注册表）。

**验证**：首屏 br 体积 793 KB → 目标 ≤550 KB；Lighthouse TTI。

### B3 ✅ sourcemap 不随包（已符合）
实测 `ui-conversation sourcemap: absent`，无需改动。保持。

---

## 9. 实施计划

> 每批都可独立提交、独立验证、独立回滚。批次内按依赖排序。

### 批次 1 · 存储急救（半天，收益最大、风险最低）

| # | 项 | 预期 |
|---|---|---|
| 1 | S1 `synchronous=NORMAL`（user/message 保持 FULL） | 写入吞吐 **15–23×**（实测 8 ms vs 143 ms / 40 事务） |
| 2 | S2 `wal_checkpoint(TRUNCATE)` + `journal_size_limit` | **WAL 534.9 MB → 0 MB**（实测 272 ms） |
| 3 | S5 `sessions` 扩列 + backfill 迁移 | **侧栏 7.0 s → <50 ms** |
| 4 | O11 `initSchema` 快路径 | 启动少 2 轮 DDL（已落地） |

**验收**：`sessions.db-wal` 体积、侧栏冷刷新计时、`packages/core/session` + `packages/server/face` 测试全绿、崩溃注入（user/message 不丢）。

### 批次 2 · 打开会话链路（1–2 天）

| # | 项 | 预期 |
|---|---|---|
| 1 | O1 SQL seq 下推 | open 读 47 ms → ~1 ms |
| 2 | O5 三处重复全扫 | 第二次 open 少 3 遍 O(n) |
| 3 | O6 权限 knob 读投影 | 每次工具调用少一遍全扫 |
| 4 | O7 list cache debounce | open 尾延迟去掉同步写盘 |
| 5 | O9 history-paginate 去多余扫描 | loadOlder CPU |

**验收**：cold open 埋点（SQL 行数 / parse 次数 / 耗时）p95 ≤200 ms；`session.history` 回归。

### 批次 3 · 前端热路径（1–2 天）

| # | 项 | 预期 |
|---|---|---|
| 1 | R2 工具行 memo + body 惰性 | 大 args 行 render 10 ms → <1 ms |
| 2 | R3 侧栏窄订阅 + 行 memo | 单行变化不再重渲染整列表 |
| 3 | R4 PresenceBall 合并订阅 | 每次渲染少 10 订阅 + 1 observer |
| 4 | R5 ChatView 派生 memo | 结构性变更帧 -0.2 ms/次（小但免费） |
| 5 | R6 InputBar 指纹标量 | 流式期少每帧全扫 |
| 6 | R7 ConversationSession 去全量订阅 | 每次按键少 1 次外壳渲染 |
| 7 | R8 DetailsPanel useMemo | 详情面板 <1 ms |
| 8 | R10 图片懒加载 | 40 图会话首帧请求 40 → 可见数 |

**验收**：各组件渲染计数 + Profiler 对比；`ui-tool` / `ui-workspace` / `ui-conversation` / `ui-plan` 测试全绿。

### 批次 4 · 闪动与滚动（2 天）

| # | 项 | 预期 |
|---|---|---|
| 1 | F2 滚动 rAF 合并 + 去命中测试 | 滚动单帧 <8 ms |
| 2 | F1 折叠行 `hidden="until-found"` + 批次动效 | 折叠不闪、不跳 |
| 3 | R1 对话流窗口化 | DOM 节点恒定，长会话不再越用越卡 |
| 4 | F3 内外层滚动跟随 | 过程组/终端跟随正确 |

**验收**：400 行 fixture 的滚动 long task、DOM 节点数、折叠 `scrollTop` 漂移、60 fps 录屏。

### 批次 5 · 交互能力（按用户优先级挑，单项 0.5–2 天）

| 优先级 | 项 | 工作量 |
|---|---|---|
| 1 | U4 密钥遮蔽 | S |
| 2 | U2 链接打开策略 | S/M |
| 3 | U6 焦点栈 + 菜单方向键 | S |
| 4 | U3 选区浮动操作 | M |
| 5 | U5 快捷键服务 | M |
| 6 | U7 轮次轨道虚拟化（依赖 B1） | M |
| 7 | U1 右栏 dock（纯前端部分） | L |
| 8 | U8 插件发现 | L |

**验收**：每项独立的交互测试 + 手动矩阵。

### 批次 6 · 泄露与包体（半天）

| # | 项 |
|---|---|
| 1 | L1 `trajectoryPaint` LRU + 卸载释放 |
| 2 | L2 `diffPaint` 上限 |
| 3 | L3 `expandedByKey` 上限 |
| 4 | L4 Think 尾块冻结 |
| 5 | B1 平台模块表 |
| 6 | B2 首屏拆分（视 code splitting 能力） |

**验收**：20 会话 Trajectory 往返后 heap 回基线；首屏 br 体积。

### 批次 7 · 需产品决策（不排期，先讨论）

- S3 chunk 双写（选 A/B/C）
- S6 FTS tokenizer（只索引三类事件 vs 换 unicode61）
- O8 增量 RPC
- U8 插件市场服务端

---

## 10. 验收指标总表

| 指标 | 现状（实测） | 目标 |
|---|---|---|
| `sessions.db-wal` | 534.9 MB | ≤64 MB（**已实测 0 MB**） |
| `sessions.db` | 745.1 MB | ≤450 MB（S4 省 135 MB + S6 FTS 减半；VACUUM 只省 18 MB） |
| 侧栏冷刷新 | ≈7,000 ms | ≤50 ms |
| 大会话 open 的 SQL 行数 | 6,505 | ≤300 |
| 大会话 open 的 JSON.parse | 6,505 | ≤300 |
| cold open p95 | 未测（估算 >1 s） | ≤200 ms |
| 冷开 `apply` 次数 | ≈110,000 | ≤20,000 |
| 滚动单帧脚本 | 未测 | <8 ms |
| 对话流 DOM 行数 | 全量 | ≤视口 ×2 |
| 大 args 工具行 render | ~10 ms | <1 ms |
| 首屏 br 体积 | 793 KB | ≤550 KB |
| `trajectoryPaint.size` | 无上限 | ≤3 |

---

## 11. 本次审计的方法与被排除项

**方法**：
- 真实数据实测：`node:sqlite` 只读打开 `~/.xrk/sessions/sessions.db`（`DatabaseSync`），取 3 次中位；脚本在 `.tmp/bench-*.mjs`。
- 包体实测：`zlib.gzipSync` / `brotliCompressSync` 对 `apps/web/dist` 产物。
- 代码审计：三路只读子代理分别覆盖「前端渲染与泄露」「DSH 对照」「打开会话链路」，每条结论要求 `文件:行号`。
- 交叉验证：子代理报的 O(n²) 假设我用真实 3,813 节点微基准证伪（实测 0.2 ms），已在 R5 中修正为「O(n) 固定税」而非「平方级」。

**明确排除（已查、无问题，避免重复劳动）**：
- `Notifier` 的微任务/rAF 双档 + 自适应绘制预算 + `isInputPending` 让位（`runtime/src/client/sessions/notifier.ts`）。
- `ChatSnapshotBuilder` 的 order/timeline/navigation 引用稳定（`chat-snapshot-builder.ts:144-190`）。
- Markdown 尾块冻结增量解析（`markdown/incremental.ts`）。
- 所有 `addEventListener` / `ResizeObserver` / `setInterval` / `rAF` / `AbortController` / `WebSocket` / `Blob URL` 的清理——逐个查过，**完整**。
- sourcemap 未随包发布。

**未覆盖**：
- `apps/desktop`（Electron 壳：`<webview>`、原生菜单、多窗口、framed pipe 是否二次 JSON）。
- `extensions/`、`apps/site`。
- 真实浏览器 Performance 面板 profile（本轮为静态 + Node 侧实测；批次 4 验收时补）。

**待确认清单**：
1. 桌面端 framed pipe 是否在 Host 侧已做过一次 JSON 序列化再传（影响 O2-21 实际字节）。
2. `hidden="until-found"` 在目标 Electron 版本的 Chromium 支持情况。
3. `bundle-client-js.mjs` 是否支持 code splitting（影响 B2）。
4. `session/event` 帧大小分布（影响 R9 优先级）。
5. `contextTimeline` 是否读 `request/header` 的完整 body（影响 S4 安全性）。

---

## 附：本轮落地记录（2026-10-24 夜）

### 已落地并验证

| 项 | 落点 | 验证 |
|---|---|---|
| O(n²) → O(n)：steering 重复判定 | `ChatView.tsx` 新增 `earliestOpenerText`，`isOpenerDuplicateSteer` 改收 opener 文本 | 原先四次 filter/some 每行各扫全表；现在一次扫描 + O(1) 比较。顺带修好 1 条基线失败（transcript echo by rpcId） |
| O(n²) → O(n)：`hasAgentWorkBefore` 逐行重扫 | `pending-input-chrome.ts` 新增 `earliestAgentWorkId`，`isLiveSteerRow` 改收阈值 | flow tail 与 last durable 两处倒序扫描从 O(n²) 降到 O(n) |
| 折叠落点补偿 | `ProcessGroupSeat.tsx` `foldAbove` + `useLayoutEffect` | 视口上方的组折叠时关过渡、按**下边沿**位移回写 `scrollTop` 并 clamp 到新 floor；读者在底部时折叠后仍停在底部。2 条新测试锁公式 |
| 补偿与账本一致 | `ChatView` 的 `writeFoldScroll` | 程序化写入同时更新 `observedTopRef`，否则 scroll handler 会判成读者滚动并丢掉 follow |
| 多组同时折叠 | 同上 | 补偿基准改为写入时的当前 `scrollTop`，同一 Turn 关闭多个 run 的补偿可叠加 |
| 折叠后 anchor 重采样 | `ProcessGroupSeat` 的 `onFoldSettled` → `ChatView` 的 `handleFoldSettled` | 组在视口内折叠时 `scrollTop` 不变但下方行移动，anchor 会指向旧位置；收尾走既有 scroll handler 重采样 |
| 视口内不折叠 | `ProcessGroupSeat` 的 `readableNow` | 除 `deferFold`（读者在底部）外，读者正看着的组也不在 Turn 关闭时收起 |
| 减少动效 | `ChatView.module.css` 的 `@media (prefers-reduced-motion: reduce)` | 折叠仍发生，只是不做高度动画 |

### 明确没做，及理由

| 项 | 理由 |
|---|---|
| 派生数据 `useMemo` | `chat.nodes` 是可变类实例（`MutableChatNodeStore`），`chat.order` 内容相同时引用被复用（`sameReferences`）。以它们为依赖的 memo 永不失效，内容更新后界面会停在第一次快照。已回滚，代码里写明原因 |
| 轨道虚拟化 | 轨道只渲染 10 格相机窗口（`TURN_RAIL_WINDOW = 10`），虚拟化是伪需求；DSH 需要虚拟化是因为它渲染全部轮次 |
| 折叠时机档位（completion / next-input） | 需要设置项与产品决策，不擅自加用户看不见的开关 |
| `ChatView` 大拆（flow 行渲染器 / 滚动 hook） | `nodeSeat` 的依赖包含父组件传入的回调（`inspectCall` / `forkAt` / `regenerateAt` …），拆分必须同步改父组件；工作树存在他人并发改动，本轮不做跨包重构 |
| steering 稳定 flow key | 需要协议侧提供 pending ↔ durable 的稳定对应，客户端无法自行推导 |

### 核对事实

- 改动文件：`ChatView.tsx`、`ChatView.module.css`、`ProcessGroupSeat.tsx`、`pending-input-chrome.ts`、`tests/process-group-seat.client.spec.tsx`
- `tsc -p packages/client/ui-conversation/tsconfig.client.json`：31 个既有错误（签名收敛使其中数个消失，未新增）
- `vitest` ui-conversation 全包：失败集合与基线逐条 `Compare-Object`，仅少 1 条（本轮修复），无新增
- 组测试：9 条全绿（新增 3 条）
