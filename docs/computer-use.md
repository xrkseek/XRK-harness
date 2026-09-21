# 桌面 computer-use

> **读者**：集成者 · 贡献者

`@xrkseek/exec-computer-use`：桌面无障碍树 + 键鼠 Provider，与页面级 `browser_*`（`@xrkseek/exec-web`）分开。

Harness 默认登记模型工具 `computer_use`；无 Provider 时工具仍可见，execute 诚实失败（同 LSP）。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `ComputerUseService`（`capture` · `act` · `listWindows`） |
| Provider | `memory` · Windows `uia`（`XRK_COMPUTER_USE=1`）· `background`（`XRK_COMPUTER_USE=background`，助手未安装则 `unavailable`）；或 Host 注入。同一注册表同时只占一个名字 |
| Consumer | `createComputerUseTools` → `computer_use`（action 判别：capture / click / type / key / scroll / list_windows）。不登记到 `browser_*` |

## 启用

| 方式 | 效果 |
|------|------|
| `XRK_COMPUTER_USE=1`（Windows） | UI Automation Provider（`delivery=uia`） |
| `XRK_COMPUTER_USE=memory` | 内存假树（CI / 演示） |
| `XRK_COMPUTER_USE=background` | 后台输入。`XRK_COMPUTER_USE_BACKGROUND` 指向已安装助手才真正发送；否则每次调用 `unavailable`。不改 UIA，也不走 `browser_*` |
| `computerUseTools: service` | 注入自定义 Provider |
| `computerUseTools: false` | 不登记工具 |

Windows UIA 仍走 Invoke/ValuePattern。后台输入是旁边的 `background` Provider，不是把 UIA 改成 SPI，也不并进 `browser_*`。`key` / `scroll` 在 UIA Provider 上暂未实现。截图 SOM 叠加尚未提供；`mode=ax` 为默认。

## 与 browser_* 分工

| 场景 | 工具 |
|------|------|
| HTTP 页面读写 / 点链填表 | `browser_open` · `browser_snapshot` · `browser_act` |
| 本机 GUI 应用（无障碍树） | `computer_use` |

---

# Desktop computer-use

> **Audience**: Integrators · Contributors

`@xrkseek/exec-computer-use` provides a desktop accessibility-tree + input Provider, separate from page-level `browser_*` (`@xrkseek/exec-web`).

Harness registers the model tool `computer_use` by default; without a Provider the tool stays visible and execute fails honestly (same pattern as LSP).

## Seams

| Layer | Content |
|-------|---------|
| Definition | `ComputerUseService` (`capture` · `act` · `listWindows`) |
| Provider | `memory` · Windows `uia` (`XRK_COMPUTER_USE=1`) · `background` (`XRK_COMPUTER_USE=background`; missing helper returns `unavailable`); or Host inject. The registry holds one name at a time |
| Consumer | `createComputerUseTools` → `computer_use` (action discriminator: capture / click / type / key / scroll / list_windows). Not registered on `browser_*` |

## Enable

| How | Effect |
|-----|--------|
| `XRK_COMPUTER_USE=1` (Windows) | UI Automation Provider (`delivery=uia`) |
| `XRK_COMPUTER_USE=memory` | In-memory fake tree (CI / demos) |
| `XRK_COMPUTER_USE=background` | Background input. Sends only when `XRK_COMPUTER_USE_BACKGROUND` points at an installed helper; otherwise every call is `unavailable`. Does not replace UIA and does not use `browser_*` |
| `computerUseTools: service` | Inject a custom Provider |
| `computerUseTools: false` | Do not register the tool |

Windows UIA still uses Invoke/ValuePattern. Background input is the separate `background` provider; it does not turn UIA into an SPI and it is not part of `browser_*`. `key` / `scroll` are not implemented on the UIA Provider yet. Screenshot SOM overlays are not shipped; default `mode=ax`.

## vs browser_*

| Scenario | Tools |
|----------|-------|
| HTTP page read / link / form | `browser_open` · `browser_snapshot` · `browser_act` |
| Host GUI apps (accessibility tree) | `computer_use` |
