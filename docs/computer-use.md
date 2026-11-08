# 桌面 computer-use

> **读者**：集成者 · 贡献者

`@xrkseek/exec-computer-use`：桌面无障碍树 + 键鼠 Provider，与页面级 `browser_*`（`@xrkseek/exec-web`）分开。

Harness 在 Settings **开启**时登记模型工具 `computer_use`；`mode=off` 时**不登记**（保存后 agent 重建热卸载）。

**产品路径**：Settings → Plugins → **Computer use**（Face ns `computer-use`：默认 **`agent-desktop`**，亦可关 / uia / background）。卡片头开关即时写入（不必展开再点保存）；打开落到 `agent-desktop`（Vercel Labs CLI；Desktop Host 经 `node_modules` 同梱，可用 `XRK_AGENT_DESKTOP` 覆盖路径）。Background 助手路径经 Credentials `XRK_COMPUTER_USE_BACKGROUND`（不进 settings.yaml）。变更后 Host `invalidateAgents` 热切换。非空 `XRK_COMPUTER_USE` 为 CI 旁路。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `ComputerUseService`（`capture` · `act` · `listWindows` · 可选 `find`） |
| Provider | `agent-desktop` · `memory` · Windows `uia`（Settings `mode=uia` 或 CI `XRK_COMPUTER_USE=uia`）· `background`（`XRK_COMPUTER_USE=background`，助手未安装则 `unavailable`）；或 Host 注入。同一注册表同时只占一个名字 |
| Consumer | `createComputerUseTools` → `computer_use`。**工具 `action` enum 与系统 guidance 均按 Provider delivery 收窄**：`agent-desktop` 为全量面；`uia` / `background` / `memory` 只挂各自能跑的动作（避免模型把 UIA 上的 launch/overlay 失败写成「空壳」）。环：list_windows → focus_window\|launch → capture\|find → click/type/key/scroll/clipboard_* → 再 capture；`mode=vision|som` 经 `saveScreenshot` 内联图。不登记到 `browser_*` |

## 启用

| 方式 | 效果 |
|------|------|
| Settings `mode=agent-desktop` 或 `XRK_COMPUTER_USE=agent-desktop` | 调用 [agent-desktop](https://github.com/vercel-labs/agent-desktop) CLI（**1.x**，AX + **快照限定 ref** `@<snapshot_id>:eN`；Windows/macOS/Linux）。Host 默认开 **CLI session + cursor-overlay**。动作面含 observe / act / windows / notifications / mouse_move|wheel / wait(--event) / overlay；`get`/`is` 走 `--property`，窗口缩放走 `--width/--height`，拖拽走 `--from/--to`。**默认 headless**。缺二进制时失败并提示 / `XRK_AGENT_DESKTOP` |
| `XRK_COMPUTER_USE=1`（Windows） | **软开启**：若 Settings 已选 `agent-desktop`/`uia`/`background` 则跟 Settings；仅当 Settings 未开时才落默认 UIA。硬钉 UIA 请写 `XRK_COMPUTER_USE=uia` |
| `XRK_COMPUTER_USE=memory` | 内存假树（CI / 演示） |
| `XRK_COMPUTER_USE=background` | 后台输入。`XRK_COMPUTER_USE_BACKGROUND` 指向已安装助手才真正发送；否则每次调用 `unavailable`。不改 UIA，也不走 `browser_*` |
| `computerUseTools: service` | 注入自定义 Provider |
| Settings `mode=off` 或 `computerUseTools: false` | **不登记**工具（热卸载） |

### 输入契约（产品）

- **元素点击 / set-value / press**：headless（CLI 默认）。
- **能力阶梯**（场景无关）：`focus_window`/`launch` → AX 元素 → `find` → clipboard →（**多模态**）vision/som → `headed=true` 坐标（须用户同意）→ 仍不可用则如实说明或 Background。**禁止** bash / PowerShell / `.ps1` / `Add-Type` / `SetForegroundWindow` / `EnumWindows` / `GetWindowRect` / `SetCursorPos` 做桌面控制——窗口与键鼠一律走 `computer_use`。**文本模型**跳过像素路径（vision/som 软降级），见 `<session_capability>` 的 `modality=`。
- **坐标点击 / 物理鼠标**：必须显式 `headed=true`（会移动真实光标）；否则工具拒绝。
- **CJK 文本**：`type` 走 clipboard-set + 粘贴；亦可 `clipboard_set` / `clipboard_get` + `key=ctrl+v`。
- **空洞 AX 树**（≤2 可用节点，如自定义绘制聊天客户端）：`focus_window` → `capture mode=vision|som` → `headed=true` 坐标点击 → clipboard 输入。不要用脚本补窗口焦点或 DPI。
- 不要与同一 Chrome 并行使用 `computer_use` 与 `browser_*`。

Windows UIA 走 Invoke / ValuePattern / SendKeys（`key`）/ ScrollPattern；物理回退需 `headed=true`。`mode=background` 把 `act` 交给 `XRK_COMPUTER_USE_BACKGROUND` 助手；`capture` 仍用 UIA。

`capture` 的 `mode`：`ax`（默认，仅无障碍树）· `vision`（窗口 PNG + AX）· `som`（PNG 上叠加 1-based 元素序号 + AX）。真截图由 Provider 产出；Harness 经 `AttachmentStore.saveImage` 与 `browser_vision` 同缝把图交给多模态模型。无附件仓时若已有 PNG，工具诚实失败。

## 与 browser_* 分工

| 场景 | 工具 |
|------|------|
| HTTP 页面读写 / 点链填表 / 页面截图 | `browser_open` · `browser_snapshot` · `browser_act` · `browser_vision` |
| 本机原生 GUI（无障碍树 + 键鼠） | `computer_use` |

系统提示：`COMPUTER_USE_PROMPT_TEXT` 与 `formatBrowserGuidance` 互相指明边界——网页走 `browser_*`，原生桌面应用才用 `computer_use`；二者不要并行驱动同一浏览器窗口。

---

# Desktop computer-use

> **Audience**: Integrators · Contributors

`@xrkseek/exec-computer-use` provides a desktop accessibility-tree + input Provider, separate from page-level `browser_*` (`@xrkseek/exec-web`).

Harness registers the model tool `computer_use` when Settings has it **on**; `mode=off` **does not register** it (hot unload on the next agent rebuild after save).

**Product path**: Settings → Plugins → **Computer use** (Face ns `computer-use`: `mode` = off / **agent-desktop** / uia / background). The master switch turns on as `agent-desktop` (Vercel Labs CLI; Desktop Host ships it under `node_modules`; override with `XRK_AGENT_DESKTOP`). Background helper path via Credentials `XRK_COMPUTER_USE_BACKGROUND` (not settings.yaml). After save, Host `invalidateAgents` hot-swaps. Non-empty `XRK_COMPUTER_USE` is the CI bypass.

## Seams

| Layer | Content |
|-------|---------|
| Definition | `ComputerUseService` (`capture` · `act` · `listWindows` · optional `find`) |
| Provider | `agent-desktop` · `memory` · Windows `uia` (Settings `mode=uia` or CI `XRK_COMPUTER_USE=uia`) · `background` (`XRK_COMPUTER_USE=background`; missing helper returns `unavailable`); or Host inject. The registry holds one name at a time |
| Consumer | `createComputerUseTools` → `computer_use`. **Action enum and system guidance are scoped by Provider delivery**: full surface for `agent-desktop`; narrower for `uia` / `background` / `memory` (so models do not treat UIA refusals as "empty shells"). Loop: list_windows → focus_window\|launch → capture\|find → click/type/key/scroll/clipboard_* → capture again; `mode=vision|som` via `saveScreenshot`. Not registered on `browser_*` |

## Enable

| How | Effect |
|-----|--------|
| Settings `mode=agent-desktop` or `XRK_COMPUTER_USE=agent-desktop` | Shells [agent-desktop](https://github.com/vercel-labs/agent-desktop) (**1.x**, AX + **snapshot-qualified refs** `@<snapshot_id>:eN`; Win/macOS/Linux). Host defaults to a durable **CLI session + cursor-overlay**. Surface covers observe / act / windows / notifications / mouse_move|wheel / wait(--event) / overlay; `get`/`is` use `--property`, resize uses `--width/--height`, drag uses `--from/--to`. **Headless by default**. Missing binary fails with install / `XRK_AGENT_DESKTOP` |
| `XRK_COMPUTER_USE=1` (Windows) | Soft enable: follows Settings when `agent-desktop`/`uia`/`background` is set; otherwise defaults to UIA. Pin UIA with `XRK_COMPUTER_USE=uia` |
| `XRK_COMPUTER_USE=memory` | In-memory fake tree (CI / demos) |
| `XRK_COMPUTER_USE=background` | Background input. Sends only when `XRK_COMPUTER_USE_BACKGROUND` points at an installed helper; otherwise every call is `unavailable`. Does not replace UIA and does not use `browser_*` |
| `computerUseTools: service` | Inject a custom Provider |
| Settings `mode=off` or `computerUseTools: false` | **Do not register** the tool (hot unload) |

### Input contract

- Element click / set-value / press: headless (CLI default).
- Escalation: `focus_window`/`launch` → AX → `find` → clipboard → (**multimodal**) vision/som → `headed=true` coordinate (user consent) → hollow/unavailable: report or Background. **Never** bash / PowerShell / `.ps1` / `Add-Type` / `SetForegroundWindow` / `EnumWindows` / `GetWindowRect` / `SetCursorPos` for desktop control — use `computer_use` only. **Text-only** routes skip pixels; see `<session_capability>` `modality=`.
- Coordinate / physical mouse: requires explicit `headed=true` (moves the real cursor); otherwise refused.
- CJK text: `type` uses clipboard-set + paste; or `clipboard_set` / `clipboard_get` + `key=ctrl+v`.
- Hollow AX (≤2 nodes, e.g. custom-drawn chat clients): `focus_window` → `capture mode=vision|som` → `headed=true` click → clipboard. Do not script window focus or DPI.
- Do not drive the same Chrome with `computer_use` and `browser_*` in parallel.

Windows UIA uses Invoke / ValuePattern / SendKeys (`key`) / ScrollPattern; physical fallback needs `headed=true`. `mode=background` sends `act` to the helper; `capture` stays on UIA.

`capture` `mode`: `ax` (default) · `vision` · `som`. Screenshots go through `AttachmentStore.saveImage` like `browser_vision`. Missing attachment store with PNG fails honestly.

## vs browser_*

| Scenario | Tools |
|----------|-------|
| HTTP page read / link / form / page screenshot | `browser_open` · `browser_snapshot` · `browser_act` · `browser_vision` |
| Native host GUI (accessibility tree + input) | `computer_use` |

System prompts: `COMPUTER_USE_PROMPT_TEXT` and `formatBrowserGuidance` cross-reference the boundary — web pages use `browser_*`; native desktop apps use `computer_use`; do not parallel both on the same browser window.
