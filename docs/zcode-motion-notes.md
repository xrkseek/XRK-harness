# ZCode Motion：我们能照搬的部分与理由

> **读者**：维护者 · Coding Agent（**笔记**）
>
> 参考仓库：`C:\Users\xrkseek\Desktop\参考仓库\ZCode`。  
> 依据：`DESIGN.md` §Motion · `packages/ui/src/styles.css` 动效段 · `packages/stream-animate`。

## 原则（ZCode 原文-derived）

1. **快**：进出场 100–200 ms。超过 250 ms 在对话面会变阻塞感。
2. **低戏剧性**：位移几个像素（`translateY(4–6px)`），缩放 `0.98 → 1`。不做弹跳、不做长弹簧。
3. **动效解释状态**：说明「从哪来、到哪去」，不是装饰。主工作区避免俏皮弹簧。
4. **只动 `opacity` 与 `transform`**：合成层友好。避免用 `height`/`width`/`margin` 做主路径动画（ZCode collapsible 用 height 是特例，我们不跟）。
5. **逐条 `prefers-reduced-motion`**：关掉动画，不是全站一个总开关了事。

本仓 token 真源：`packages/client/ui-theme/src/styles/interaction.css`（`--ds-motion-*` · `--ds-ease-*`）。

## 已落到本仓

| 表面 | 落点 | 取值 |
|---|---|---|
| Modal 进出场 | `ui-primitives` Modal | 进 160/180 ms（`--ds-ease-out`）· 出 **120 ms**（对齐 `EXIT_MS`）；三态 `closed/open/closing`；reduced-motion 即时拆 |
| Menu / 子菜单进场 | `Menu.module.css` | `--ds-motion-fast` + `--ds-ease-out`；下开 `translateY(-4px)`、上开 `+4px`；`scale(0.98→1)` |
| HoverCard 进场 | `HoverCard.module.css` | 同 Menu：`--ds-motion-fast` + 位移/缩放；reduced-motion 关 |
| Tooltip / Toast | Tooltip · Toast | Tooltip 140 ms 淡入；Toast 160 ms 进 + hold/fade（`--ds-ease-*`） |
| Turn 导航轨高度 | `TurnNavigator.module.css` | `--ds-motion-fast`（侧栏轨，非正文折叠） |
| 过程折叠 | `useFoldDriver` | **一帧** `hidden=until-found` + 上方读者 `scrollTop` 补偿；**不**动画 height |
| 侧栏 / 行入场 | sidebar · workspace rows | 150–200 ms，已用 `--ds-ease-in-out` |
| 概况 / 画布 pane | `PreviewTabs` · `OverviewCanvasPanel` | `--ds-motion-fast` + `translateY(4px) scale(0.98)`；tab/chip press `scale(0.96)`；callout 用表面 tint（无粗色左边条） |
| 设置面板进场 | `SettingsRoot` mask/panel | 对齐 Modal：mask 160 ms · panel 180 ms；nav 切换 `optionsPane` 150 ms；仅进场（关即卸） |

### Modal 坑（勿回退）

1. `open=false` 当帧 `return null` 会吃掉退场 → 必须 `closing` 再卸。
2. `EXIT_MS` 必须对齐 CSS 出场时长（现 **120 ms**，快于 `--ds-motion-fast`）。
3. reduced-motion 时延迟归 0。

## 明确不跟（避免臃肿 / 违本仓手感）

| ZCode 项 | 为何不跟 |
|---|---|
| `zcode-stream-text-in` **900 ms** 流式淡入 | 与「快」原则冲突；流式应几乎无感 |
| `stream-animate` 帧预算 / token 速率预测 | 工程重、收益在我们「直接 React 增量」路径上不划算 |
| Collapsible **height** 动画 + `!important` 盖 Radix | 触发布局；本仓折叠用既有 grid/opacity 即可 |
| Draft prompt waterfall + `clip-path` | 装饰感偏强；主对话不引入 |
| 工具条 indeterminate `left` 扫光 | 可后续按需；非会话底层 |

## 又快又顺：分工

| 目标 | 靠什么 | 不靠什么 |
|---|---|---|
| **快** | Host/store（R6–R9）、投影 cache、list hints | 更长 CSS、stream-animate |
| **顺** | 统一 overlay 进场语法；折叠一帧落地 + scroll 补偿 | height 过渡、第二套 fold 驱动 |

会话 Branch / 编辑重发 / loadOlder 的**速度**靠 Host/store。  
动效只负责：菜单/HoverCard 打开可感知、确认框进出场干净、busy 图标旋转——**不加第二套动画体系**。

## 证据

- `ui-primitives/tests/modal-focus.client.spec.tsx`：含 closing 窗口断言。
- Menu 进场为纯 CSS；既有 Menu 行为测例不依赖「零动画」。
