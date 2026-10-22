# 子代理团队 / 委派图 / 注入 UI —— 开源实现调研与本仓改造建议

> **读者**：产品 / 前端 · 维护者
> **状态**：调研结论（2026-10）。所有 URL 与版本号均已实际请求核实；本仓结论均已逐处读源码确认。

## 一句话结论

**本仓的委派图和注入数据层都已经建好了**，而且建得不错：
`agent-team-graph.ts`（图模型）→ `session-status.ts`（投影）→ `preview-load.ts`（client 契约）→
`SubagentGraphBoard.tsx`（SVG 分层看板）这条链路**全线打通**，
`live` 行里连 `queued` / `steering` 计数都传到了客户端。

**真正缺的不是"有没有 UI"，而是三处"最后一公里"**：

| 缺口 | 现状（已核实） | 对标开源 |
| --- | --- | --- |
| **看板节点不是表情球** | `SubagentGraphBoard` 节点是 `StateDot` + 文字方框；表情球只在 `TeamRoster` 名册里 | 本仓独有资产，无对应开源 |
| **注入状态在看板上看不见** | live 列表**已渲染** `q=N/steer=M`（`PreviewTabs.tsx:971`），但**看板节点没有** | OpenHands `{queued, position}` |
| **人类对子代理不能注入** | 子代理会话是 `SubagentReadOnlyComposer` 只读；注入只在工具层 | OpenHands interrupt/steer/queue · pi-mono `deliverAs` |

**不需要引入 React Flow**。本仓图规模是会话树（通常 < 20 节点），
`SubagentGraphBoard` 自己的 SVG + 分层布局已经够用；Langfuse（36k★，本仓最贴的对照物）**也没有用 React Flow**。

---

## 二、本仓现状（逐处读源码核实）

### 2.1 委派图：全链路已通 ✅

```
packages/server/face/src/agent-team-graph.ts    图模型：nodes / edges(delegates|peer) / roleOf / depthFrom / view(rootId) / neighbors()
        │ recordDelegation / rebuildDelegations / meshSiblingPeers（兄弟自动 mesh peer 边）
        ↓
packages/server/face/src/session-status.ts:1130  SessionStatusGraph { nodes, edges }，每节点带 activity + outcome
        ↓
packages/client/ui-plan/src/client/preview-load.ts:443  client 契约解析（nodesRaw / edgesRaw）
        ↓
packages/client/ui-plan/src/client/PreviewTabs.tsx:926  <SubagentGraphBoard> 渲染
```

`SubagentGraphBoard.tsx` 已有：
- SVG 分层布局（`layout()`：BFS 深度 → 列，列内序号 → 行，`COL_W=148 / ROW_H=64`）
- 贝塞尔连线（`edgePath()`）+ 箭头 marker
- `edgeLive` 运行态描边（子节点 running 时边变活）
- `mergeGraph()` 把不在图里的 live 子代理补成节点、把 live 行合并进图节点
- 节点点击 → `onOpenNode` 打开子会话
- `data-activity` / `data-outcome` / `data-depth` / `data-model` 属性（便于测试与调试）

### 2.2 注入：语义与数据都在，缺人类入口 ⚠️

| 层 | 现状 |
| --- | --- |
| 工具层 | `subagent-tools.ts`：`followup_task`（默认 steer）/ `send_message`（`delivery=steer\|queue`）/ `interrupt_agent` / `close_agent` / `wait_agent` |
| 投影层 | `session-status.ts:301-302`：`SessionStatusSubagentLive` 已有 `queued: number` + `steering: number` |
| client 契约 | `preview-load.ts:217-218`：`queued` / `steering` 已解析并透传 |
| **live 列表渲染** | ✅ 已有：`PreviewTabs.tsx:971-972` 渲染 `q=N/steer=M`（走 i18n `t('preview.status.subagentQueue')`） |
| **看板节点渲染** | ❌ `SubagentGraphBoard` 的节点**没有** `queued` / `steering` 角标 |
| **人类入口** | ❌ `SubagentReadOnlyComposer.tsx` 明确渲染只读理由（`one-shot` / `parent-unavailable`）——**continuable 子代理会话里人也不能发消息** |

### 2.3 表情球：本仓独有资产 ✅

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| 引擎 | `apps/web/public/presence/emotion-ball/` | `rings.js`/`emotions.js`/`ball.js`/`engine.js`；`EmotionBall.create(el, opts)` 支持 `shape/color/kit*/emotion/idle/lite` |
| 组件 | `packages/client/ui-workspace/src/client/CompanionBall.tsx` | 15 shape × 20 color × 9 kit；`companionPaint(color, dark)` → `{body, eyes}` |
| 名册 | `packages/client/ui-workspace/src/client/TeamRoster.tsx` | 表情球卡片网格、装扮编辑、作用域（global/workspace）、`inject`（minimal/subagent）、导出/导入 |
| 状态点 | `packages/client/ui-primitives/src/StateDot.tsx` | `done`/`warning`/`ongoing`/`error`；`ongoing` 是**像素追逐**动画（3×3 矩阵顺时针 + 负延迟错峰） |
| 活动映射 | `packages/client/ui-primitives/src/subagent-activity-dot.ts` | `activity`（running/inactive）× `outcomeKind`（7 种终局）→ `StateDot` |

---

## 三、开源可借鉴点

### 3.1 状态语义表 —— magentic-ui（MIT，已核实）

[microsoft/magentic-ui](https://github.com/microsoft/magentic-ui) · **10,097★** · MIT（`LICENSE` 原文已读）

`frontend/src/lib/constants.ts` 的 `SESSION_STATUS_UI_CONFIG` 把 7 种状态映射为五元组
`{icon, colorClass, dotColorClass, cardLabel, chatLabel}`，**一处定义、卡片与聊天底部指示器共用**。

状态集：`created` / `active` / `awaiting-input` / `paused` / `stopped` / `completed` / `error`。

**对本仓的价值**：本仓 `subagentActivityDot` 已做同样的事（`activity × outcomeKind` → `StateDot`），
但**缺 `label` 这一维**——`SubagentHeaderLineage` 的 outcome 文案是散在组件里的 `t('outcome.xxx')` 硬编码，
`SubagentGraphBoard` 又另写了一套 `abnormalLabel()`（**英文硬编码**，没走 i18n）。
→ 抄的是"一张表"的组织方式。

**注意**：本仓 `StateDot` 的像素追逐**优于** magentic-ui 的 `LoaderCircle animate-spin`
和 glinui 的 `motion-safe:animate-pulse`。**不要替换动画，只抄表的组织方式。**

**顺带发现一个语义损失**：magentic-ui 有 `awaiting-input`（等用户输入）这一态，
本仓 `activity` 只有 `running` / `inactive` 二值——
**"子代理在等我回答"和"子代理干完了"目前都映射成 `done`**（`subagentActivityDot` 返回 `'done'`）。
这是真实的信息丢失。

### 3.2 委派图 —— Langfuse Agent Graphs（MIT core，已核实）

[langfuse/langfuse](https://github.com/langfuse/langfuse) · **36,155★** · core MIT（`/ee/` 除外）

`web/src/components/trace2/` 是目前**最贴本仓委派图**的开源实现。三个可抄点：

1. **Aggregated / Expanded 双视图**
   - Aggregated：同名步骤合并成单节点带计数 `retrieve_docs (3/3)`，循环画成环 → 看全局规模
   - Expanded：每次调用独立节点 → 看单次执行
   - → 对应本仓：Aggregated = 按干员合并；Expanded = 每次 spawn 一个节点。
2. **确定性布局**：同一 trace 每次打开位置一致，pan/zoom 保持视口。
   → 本仓 `layout()` 已按 BFS 深度分层，**节点 id 已是 sessionId（稳定）**，天然满足。
3. **自研 canvas renderer，非 React Flow** —— 印证了"不引 React Flow"的判断。

**另一个可抄的**：[jaegertracing/jaeger-ui](https://github.com/jaegertracing/jaeger-ui) · Apache-2.0 ·
span tree **点击高亮祖先链**、耗时甘特条与 trace 树联动。
→ 本仓看板点击节点只做"打开会话"，**没有高亮路径**。加上"高亮当前节点到 root 的委派链、其余淡出"是低成本高感知改进。

### 3.3 注入语义 —— OpenHands / pi-mono / Cline（均已核实）

| 项目 | 许可证·star | 可抄点 |
| --- | --- | --- |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | MIT · 91k | **interrupt / steer / queue 三元已成事实标准**（对齐 Codex App）。`POST /pending-messages` 返回 **`{queued, position}`**——**队列位置号**正是本仓缺的信号 |
| [badlogic/pi-mono](https://github.com/badlogic/pi-mono) `packages/coding-agent/docs/rpc.md` | MIT · 117k | 投递枚举 `deliverAs: "steer"`（当前轮 tool call 完、下次 LLM 调用前插入）/ `"followUp"`（agent 空闲后）/ `"nextTurn"`（不打断）。`triggerTurn:true` = 空闲时立即起轮。**语义与本仓 steer/queue 几乎同构，命名可直接沿用** |
| [cline/cline](https://github.com/cline/cline) | Apache-2.0 · 71k | v4.0.0 加「queued prompts」：运行中提交进队列、随当前轮流式展示、可取消。Desktop v0.0.29：**空 composer 按 Enter = 插队领取队列头**，**队列头原子领取**防连按两次；插队失败**弹 toast 而非静默** |
| [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) | Apache-2.0 · 24k（**2026-05-15 已归档，只读**） | [消息队列文档](https://roocodeinc.github.io/Roo-Code/features/message-queueing/)：队列消息**可编辑/删除**；队列消息被处理时**隐式批准下一次工具调用**。踩坑 #10675/#7084：队列消息被误当 askResponse 吞掉 |

**对本仓的价值**：本仓 `send_message` 已有 `delivery: steer \| queue`，**语义不缺**。
缺的是**渲染**（`queued`/`steering` 数字已有却没画）+ **人类可用的注入入口** + **队列位置可见**。

### 3.4 折叠头 shimmer + 日志去重 —— magentic-ui / open-multi-agent-canvas

- **magentic-ui** `frontend/src/components/chat/messages/OrchestratorToolMessage.tsx` + `CollapsibleHeader.tsx`：
  折叠头**运行中用 shimmer 文字流动**（3s 循环 + `animationDelay` 负偏移错峰，多块不同时闪），
  完成后切过去时态；**未完成但会话已终止时停 shimmer**，避免永久转圈。
  → 直接补上本仓「干员卡片折叠后如何表达在跑」。
- **[CopilotKit/open-multi-agent-canvas](https://github.com/CopilotKit/open-multi-agent-canvas)** ~553★（**根目录无 LICENSE 文件，仅 README 声明 MIT，抄前须确认**）
  `frontend/src/components/agents/researcher.tsx`：子代理产出**流式内联渲染不弹窗**；
  `logs` reducer 用 **message 字符串去重合并**、**只允许 done 由 false→true 单向跃迁**（避免日志回退闪烁）。

### 3.5 只能当参考（不可抄 / 非目标形态）

| 项目 | 许可证 | 原因 |
| --- | --- | --- |
| [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix) | **ELv2（非 OSI）** | 代码不能抄 |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) Studio | 产品闭源 | 只有 SDK 开源，**无图 UI 可抄** |
| [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) | **AGPL-3.0** | 抄进本仓会传染 AGPL |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Apache-2.0 | README 首屏已声明 **sunsetting**，别当长期依赖 |
| [microsoft/vscode-copilot-chat](https://github.com/microsoft/vscode-copilot-chat) | MIT（**已 archived**） | 新功能在上游私有仓库 |
| [stravu/crystal](https://github.com/stravu/crystal) | MIT · 3.1k | **Electron + React 桌面**形态同构，多会话并行排布值得对照 |
| [agentscope-ai/agentscope-studio](https://github.com/agentscope-ai/agentscope-studio) | Apache-2.0 · 660 | 运行时拓扑/时序视图参考 |

### 3.6 库层结论

| 库 | 许可证 | 版本（已核实） | 建议 |
| --- | --- | --- | --- |
| `@xyflow/react` | MIT | 12.12.0 | **不引入**。本仓 `SubagentGraphBoard` 自研 SVG 已够用；Langfuse 也没用 React Flow |
| `@dagrejs/dagre` | MIT | 3.1.1 | **暂不引入**。本仓 `layout()` 的 BFS 分层已足够；真要换再引。**别用老 `dagre@0.8.5`**（8 年未更新、无 TS 类型） |
| `elkjs` | EPL-2.0 / GPL-3.0 | 0.12.0 | 备选（Langfuse 选它为确定性布局） |
| `motion` | MIT | 14.5.0 | 若要节点位置插值动画再引。**现开源没有现成的图 diff 实现**，得自己写 |
| `graphology` | MIT | 0.26.0 | 可作图算法层（祖先链、环检测），不必绑渲染 |
| `cytoscape` / `sigma` | MIT | 3.34.4 / 4.0.3 | **不引入**，千级节点场景才需要 |

---

## 四、落到本仓的改造建议（按投入产出排序）

### 建议 1：看板节点换成表情球 ★★★★★

**做什么**：`SubagentGraphBoard` 的节点从「StateDot + 文字方框」改成**表情球 + 名字**——
每个干员在图上就是**他自己的那只球**（`shape`/`color`/`kit` 来自 `TeamRoster` 的装扮数据），
跑动、呼吸、情绪，与在名册和会话里看到的是同一只。

**为什么这是本仓的独有价值**：开源社区的多代理看板全是
`state-marker + label` 的方框（Langfuse / Jaeger / Prefect 全是），
**没有一个把"角色身份"做成可穿戴形象**。表情球是本仓已有的资产，把它接到看板上，
是开源抄不到、也只有 XRK 能做的差异化。

**实施要点**：
1. **服务端几乎零成本**：装扮 wire 通道**已经存在**——
   `agent-roster-store.ts:359` 的 `appearanceLookWire(look, stickers)` 已能产出
   `{shape, color, kit?, kitHat?, kitGlasses?, kitHeld?, overlayHat?, overlayGlasses?, overlayHeld?}`，
   `session-status.ts:914` 的 `companionBallForChild()` 已经在用它给**子会话**配球（Overview 球）。
   → 只要在 `SessionStatusGraph` 的 node 上多带一个 `appearance` 字段（复用 `appearanceLookWire`），
   看板上每个干员就能拿到自己的装扮。
2. **客户端球渲染能力在 `ui-plan` 侧已有**：`packages/client/ui-plan/src/client/PresenceBall.tsx`
   已经有一套 `EmotionBall` 挂载 + 生命周期逻辑，且 `ui-plan` 已依赖 `ui-primitives`。
   → **优先复用/扩展 `PresenceBall`**，而不是从 `ui-workspace/CompanionBall` 复制一份。
   真正该决策的是：`CompanionBall`（ui-workspace）与 `PresenceBall`（ui-plan）
   **各写各的 `EmotionBall.create` 挂载逻辑**——这本身是个可以顺手收口的重复，
   收口后两个场景共用一份球组件。
3. 节点尺寸：球约 32-40px，现有 `NODE_H=40` 刚好；`COL_W=148` 够放球 + 名字。
4. 表情球有 `lite` 模式（`CompanionBall` 传 `lite: true`），看板节点正合适——不用跑完整动画。

**顺带**：球本身就是状态显示器（呼吸 = 活着），
可以考虑在 running 时让球动起来、idle 时静止——**用球代替 `StateDot` 表达状态**。

### 建议 2：看板节点补 `queued` / `steering` 角标 ★★★★

**做什么**：`queued` / `steering` 数据已在 client 手里（`preview-load.ts:217-218`），
live 列表**也已经在渲染**（`PreviewTabs.tsx:971-972` 的 `q=N/steer=M`）。
**只有看板节点没有**——所以用户在看板上完全看不出"这个子代理正被人插队/排队"。

**画什么**（抄 OpenHands 的 `{queued, position}`）：
- 看板节点角标：`steer=2` 用醒目色（插队是高优先动作），`q=3` 用中性色
- 边也可以加流动粒子表示"正在 steer"

**为什么重要**：看板是**全局视角**（一次看全队），
live 列表是逐行细看。用户往往在看板模式巡视全局——
**"谁在被插队"这种信息恰恰只在全局视角有价值**。

**低成本**：数据已在，前端加角标渲染 + i18n 文案即可，**不动服务端**。

### 建议 3：人类注入入口 —— 把只读改成"可切模式" ★★★★

**做什么**：`SubagentReadOnlyComposer` 从**硬墙**改成**可切模式**：
默认只读（保持现状），但提供"接管"入口，让人类能往运行中的子代理投递消息。

**语义照抄 pi-mono 的 `deliverAs` 三值**（本仓 `send_message` 已有 steer/queue，命名直接沿用）：

| pi-mono | 本仓对应 | 语义 |
| --- | --- | --- |
| `steer` | `delivery: 'steer'` | 当前轮 tool call 完、下次 LLM 调用前插入（**插队**） |
| `followUp` | `delivery: 'queue'` | agent 空闲后再处理（**排队**） |
| `nextTurn` | （待定） | 不打断 |

**UI 要点（抄 Cline）**：
- 空 composer 按 Enter = **插队领取队列头**，用**队列头原子领取**防连按两次
- 插队失败**弹 toast**，不静默失败
- 队列行**可编辑/删除**——本仓 `QueueDock` 已有这两项，可复用组件

**"接管"的边界**（本仓特有约束，别踩）：
- `one-shot` 子代理**不能**接管（`SubagentReadOnlyMatch.reason === 'one-shot'` 已有这个判定）——它跑完即退
- 人类注入的是**用户消息**，不是 agent 指令——措辞与 `followup_task` 的"新任务"语义不同，
  **不应复用同一个文案模板**

### 建议 4：状态语义收口成一张表 + 补 `awaiting-input` ★★★

**做什么**：
1. 把 `subagentActivityDot` 扩成 `{dot: StateDotState, label: string, tone}` 三元组，
   文案从组件里抽出来（现在散在 `SubagentHeaderLineage` 的 `t('outcome.xxx')` 和
   `SubagentGraphBoard` 的英文硬编码 `abnormalLabel()` 两处）
2. 补 `awaiting-input` 态——本仓 `activity` 只有 `running`/`inactive` 二值，
   **"子代理在等我回答"目前和"干完了"都显示 `done`**，是真实的信息丢失

**收益**：`TeamRoster` 卡片、`SubagentHeaderLineage` 树行、看板节点**共用一份**，
状态文案不会两处跑偏——这正是 magentic-ui `SESSION_STATUS_UI_CONFIG` 解决的问题。

### 建议 5：看板交互补两件事 ★★★

1. **高亮祖先链**（抄 Jaeger UI）：点击节点时，高亮它到 root 的委派路径，其余淡出。
   本仓 `SubagentGraphBoard` 点击只做"打开会话"，没有路径高亮。
2. **Aggregated / Expanded 双视图**（抄 Langfuse）：Aggregated 按干员合并看全局规模，
   Expanded 每次 spawn 一节点看单次执行。
   本仓 `mergeGraph()` 已有"live 行合并进图节点"的逻辑，是天然的 Aggregated 雏形。

### 建议 6：折叠头 shimmer + 产出流去重 ★★（打磨）

- **shimmer**：干员卡片折叠后用流动文字表明"在跑"，会话终止即停（抄 magentic-ui `CollapsibleHeader.tsx`）
- **产出流 reducer**：message 字符串去重合并 + done 单向跃迁（抄 open-multi-agent-canvas `researcher.tsx`）
- **本仓 `StateDot` 别动**：像素追逐动画已优于开源那些 `animate-spin` / `animate-pulse`

---

## 五、明确不建议做的

| 不做 | 原因 |
| --- | --- |
| 引入 React Flow / Cytoscape / Sigma | 本仓 `SubagentGraphBoard` 自研 SVG 已够用，图规模 < 20 节点；Langfuse 自己也没用 React Flow |
| 引入 dagre | 本仓 `layout()` 的 BFS 分层已足够；引入只增加依赖 |
| 抄 Phoenix / LangGraph Studio | ELv2 非 OSI / 产品闭源 |
| 抄 claude-squad | AGPL-3.0 传染 |
| 替换 `StateDot` 为 pulse 动画 | 本仓像素追逐已更好，且 `prefers-reduced-motion` 需另测 |
| 让人类注入走 `followup_task` 同一文案 | 用户消息 ≠ agent 指令，语义不同 |
| 为委派图新造 RPC 通道 | **已有** `session-status.ts` → `preview-load.ts` 通道，加字段即可 |

---

## 六、核实记录

### 开源事实（全部实际请求核实）

- `https://registry.npmjs.org/@xyflow/react/latest` → 12.12.0，license MIT ✓
- `https://registry.npmjs.org/@dagrejs/dagre/latest` → 3.1.1，license MIT ✓
- `https://ungh.cc/repos/microsoft/magentic-ui` → 10,097★ ✓
- `https://ungh.cc/repos/langfuse/langfuse` → 36,155★ ✓
- `https://raw.githubusercontent.com/microsoft/magentic-ui/main/LICENSE` → MIT 原文 ✓
- `https://raw.githubusercontent.com/microsoft/magentic-ui/main/frontend/src/lib/constants.ts` → `SESSION_STATUS_UI_CONFIG` 原文 ✓

### 本仓事实（读源码确认）

- `packages/server/face/src/agent-team-graph.ts` — 图模型全文读过
- `packages/server/face/src/session-status.ts:330-360, 1100-1155` — 投影构造读过
- `packages/client/ui-plan/src/client/preview-load.ts:440-500, 980-995` — client 契约读过
- `packages/client/ui-plan/src/client/SubagentGraphBoard.tsx` — 全文读过
- `packages/client/ui-plan/src/client/PreviewTabs.tsx:900-965` — 渲染点读过
- `packages/client/ui-subagent/src/client/SubagentReadOnlyComposer.tsx` — 全文读过
- `packages/client/ui-primitives/src/StateDot.tsx` · `subagent-activity-dot.ts` — 全文读过
- `packages/client/ui-workspace/src/client/CompanionBall.tsx` · `TeamRoster.tsx` — 读过

### 踩坑记录

GitHub REST API（`api.github.com`）在本机出口 IP 上持续 `403 API rate limit exceeded`，
故 star 数与许可证改走 `ungh.cc/repos/{owner}/{repo}` 元数据端点 + `raw.githubusercontent.com` 直读 LICENSE 原文。
`CopilotKit/open-multi-agent-canvas` 的 `raw/LICENSE` 返回 404（无 LICENSE 文件，仅 README 声明 MIT）。
