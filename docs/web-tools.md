# Web 工具

> **读者**：集成者 · 贡献者

`@xrkseek/exec-web`：`web_search` / `web_fetch` / `browser_open` · `browser_snapshot` · `browser_act`。Harness / server preset 默认登记；minimal 不登记。  
产品入口 `web` / `serve` 默认 **harness**（见 [profiles.md](./profiles.md)）。

## 产品配置（优先）

| 入口 | 字段 |
|------|------|
| Settings → Plugins → **Web search** | `provider` · `region` · Tavily / Brave / DeepSeek 密钥（经 Credentials 落盘） |
| Settings → Plugins → **Browser** | `mode`（默认 **`agent-browser`** / `http` / `cdp`）· `headed`（默认开）· `restore`（默认开）· `profile` · `proxy` · `autoConnect` · `statePath` · `executablePath` · `cdpUrl`；CLI：`XRK_AGENT_BROWSER` · `AGENT_BROWSER_*`（见下） |
| Settings → Credentials | 同槽也可改 Tavily / Brave / DeepSeek Search |

Host 把 Web search 合成结构化 `webSearch`（`SearchAccessConfig`）传入 `createDefaultWebAccess({ search })`；Browser 合成 `browserProduct` 传入 `createBrowserSession({ product })`。均在 agent 重建后生效。非空 `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` 为 CI 旁路。DeepSeek Search 与对话共用 Bearer；Host 在缺 `web.deepseek` 时复用 `llm.deepseek` / `DEEPSEEK_API_KEY`。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | 匿名 HTTP fetch；有密钥 Auto 用 Tavily / Brave；**钉选** DeepSeek 时走 Search API（`POST /v1/tools/search`）；否则 **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face 卡走 `presentCall` / `presentResult`（`card: "web"`）；`createBrowserTools(session)` — 交互式会话 |

## Headless / CI（可选 env）

| Env | 含义 |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave |
| `XRK_DEEPSEEK_SEARCH_API_KEY` | DeepSeek Search（缺省可回退 `DEEPSEEK_API_KEY`） |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选 Parallel URL |
| `XRK_WEB_SEARCH_PROVIDER` | 钉死提供方（覆盖 Settings）：`tavily` · `brave` · `deepseek` · `parallel-free` · `duckduckgo` |
| `XRK_WEB_SEARCH_REGION` | DuckDuckGo `kl` |
| `XRK_WEB_FETCH_ALLOWLIST` | 可选：逗号分隔主机名（支持 `*.example.com`）。非空时 `web_fetch` 仅允许列出主机；空则开放（仍拦私网）。决策写入进程内审计环（`getOutboundAllowlistAuditLog`）；Host 注册 `setOutboundAllowlistAuditObserver`；`xrkh doctor` 显示审计尾。**非** MITM/SOCKS，Starlark execpolicy 后置 |

默认无密钥也能搜（Parallel 免费 MCP；不行再 DDG HTML）。默认最多 **8** 条源。`web_search` 与 `web_fetch` 均可选工具参数 `proxy`（如 `http://127.0.0.1:7897`）。

## Fetch

始终可用（**不需要 key**）。`GET`、只跟 **同源** 跳转、超时 30s、body 约 5MB / 10 万字符。HTML 在工具侧剥成纯文本。**图片 / PDF 等二进制**只回 HTTP 状态、`Content-Type` 与长度（body 不进模型），便于核实可下载直链。可选工具参数 `proxy`（如 `http://127.0.0.1:7897`）；未传时沿用进程 `HTTP_PROXY` / `HTTPS_PROXY`（Host spawn 时装 undici `EnvHttpProxyAgent`）。默认 UA：`xrk-harness/0.0.4 (+https://github.com/xrkseek)`。非 2xx 仍返回页面（不是 tool error）。超时与提供方错误标 **transient**，跟 LLM 挂起共用 settle 重试次数（壳 `llm/retry` 条）。

URL 仅 `http`/`https`，拒凭据。字面量 loopback / RFC1918 / link-local 直接拒绝。**不**做 DNS 再绑定；解析到内网 IP 的公网名拦不住。

## 浏览器操作

Harness 在启用 web 工具时登记 `browser_open` / `browser_snapshot` / `browser_act`：

| 工具 | 作用 |
|------|------|
| `browser_open` | 打开 URL，返回带 `@eN` 的元素快照 |
| `browser_snapshot` | 当前页元素列表（`full=true` 附正文） |
| `browser_act` | `click` / `type`（需 `@eN`）；**`scroll`**（up/down）· **`press`**（Enter/Tab…）· **`back`**（Hermes 对齐；HTTP 快照下 scroll/press 回 `WEB_BROWSER_NO_GRAPHICS`，HTTP 会话也维护 history 供 back） |
| `browser_vision` | 截当前图形页给 vision（文本 `@eN` 旁加图片）。HTTP 快照没有浏览器时失败，不用元素列表冒充截图。**不是**视频理解（视频文件用 `video_analyze`） |
| `browser_eval` · `browser_wait` · `browser_get` · `browser_find` · `browser_frame` · `browser_tabs` · `browser_cookies` · `browser_hover` · `browser_select` · `browser_forward` · `browser_reload` | agent-browser 图形会话额外工具（超 Playwright MCP 子集；HTTP 会话不登记）。弱/文本模型主环优先 open/snapshot/act/wait；阶梯：@ref → find → covered → frame → wait → eval →（**多模态**）vision；文本路由上 `browser_vision` 软降级。`browser_get` 的 text/html 可带 `selector`（缺省 `body`）；tabs `label` 非 ASCII 会 slug；covered/daemon EOF 有提示与短重试 |
| `browser_vault_list` | 列出不透明凭证句柄（label / origin；**永不返回密钥**） |
| `browser_vault_fill` | 用句柄向当前页 `@eN` 字段填密（服务端 type；结果仅 success/handle/origin） |

产品默认会话是 **agent-browser**（[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)，Apache-2.0，Rust CLI，维护活跃；仍为 **0.x**，旗标/输出偶有破坏性变更，本仓钉 `package.json` 版本）。Desktop Host 同梱 CLI（`XRK_AGENT_BROWSER` 可覆盖）。**Chromium 不随 npm 包自动下齐**：首次在本机跑 `agent-browser install`（写入 `~/.agent-browser/browsers`），或设 Settings `executablePath` / `AGENT_BROWSER_EXECUTABLE_PATH`。默认 **`headed=true`**（可见窗口）· **`restore=true`**（按会话记住 Cookie）；可选 `profile` / `proxy` / `autoConnect` / `statePath` 复用系统登录态。CLI 自身配置见 [agent-browser.dev/configuration](https://agent-browser.dev/configuration)。无 CLI 时可改 Settings → HTTP 快照。可选 **CDP**（`cdpUrl` / `XRK_BROWSER_CDP_URL`）。这不是桌面 computer-use。

Host（harness/server）经 `createBrowserRuntimeRegistry` 按 **会话 id** 共享同一 `BrowserSession`：Agent invalidate / Settings 热重建后仍保留已打开页面与 CDP 连接；会话 finalize 或 Host stop 时 `drop`/`dispose`。工具失败经 `tool/result.error.code` 归类（如 `WEB_BROWSER_NO_PAGE` · `WEB_BROWSER_NO_GRAPHICS` · `WEB_BROWSER_NO_ATTACHMENTS` · `WEB_BROWSER_BAD_REF` · `WEB_BROWSER_CDP`）。`browser_vault_*` 由 Host 把 Face `listCredentialSlots` / `credentials.peek` 注入 `createBrowserVaultTools`（Hermes opaque-handle 子集；有 origin 时校验页面 origin）。

## 卡回放

`tool/result.meta` 带 `card: "web"`，冷 history 可回放搜索/抓取卡。

---

# Web Tools

> **Audience**: Integrators · Contributors

`@xrkseek/exec-web` provides `web_search` / `web_fetch` / `browser_open` · `browser_snapshot` · `browser_act`. Harness and server presets register them by default; minimal does not. Product entrypoints `web` / `serve` default to **harness** ([profiles.md](./profiles.md)).

## Product configuration (preferred)

| Entry | Fields |
|------|------|
| Settings → Plugins → **Web search** | `provider` · `region` · Tavily / Brave / DeepSeek secrets (persisted via Credentials) |
| Settings → Plugins → **Browser** | `mode` (default **`agent-browser`** / `http` snapshot / `cdp`) · `cdpUrl` (CDP only); override CLI with `XRK_AGENT_BROWSER` |
| Settings → Credentials | Same slots may edit Tavily / Brave / DeepSeek Search |

The Host synthesizes Web search into `webSearch` (`SearchAccessConfig`) for `createDefaultWebAccess({ search })`, and Browser into `browserProduct` for `createBrowserSession({ product })`. Both take effect after agent rebuild. Non-empty `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` is the CI bypass. DeepSeek Search shares the chat Bearer; when `web.deepseek` is unset the Host reuses `llm.deepseek` / `DEEPSEEK_API_KEY`.

## Seams

| Layer | Content |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | Anonymous HTTP fetch; Auto with keys uses Tavily / Brave; **pin** DeepSeek for Search API (`POST /v1/tools/search`); else **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face cards via `presentCall` / `presentResult` (`card: "web"`); `createBrowserTools(session)` — interactive session |

## Headless / CI (optional env)

| Env | Meaning |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave |
| `XRK_DEEPSEEK_SEARCH_API_KEY` | DeepSeek Search (falls back to `DEEPSEEK_API_KEY`) |
| `XRK_PARALLEL_FREE_MCP_URL` | Optional Parallel URL |
| `XRK_WEB_SEARCH_PROVIDER` | Pin provider (overrides Settings): `tavily` · `brave` · `deepseek` · `parallel-free` · `duckduckgo` |
| `XRK_WEB_SEARCH_REGION` | DuckDuckGo `kl` |
| `XRK_WEB_FETCH_ALLOWLIST` | Optional comma-separated hostnames (`*.example.com` ok). When set, `web_fetch` only allows listed hosts; empty stays open (private hosts still blocked). Decisions go to an in-process audit ring (`getOutboundAllowlistAuditLog`); Host registers `setOutboundAllowlistAuditObserver`; `xrkh doctor` shows the audit tail. **not** MITM/SOCKS — Starlark execpolicy deferred |

Search works without keys by default (Parallel free MCP, then DDG HTML). Default max sources: **8**. Both `web_search` and `web_fetch` accept an optional `proxy` tool argument (e.g. `http://127.0.0.1:7897`).

## Fetch

Always available (**no key required**). `GET`, follow **same-origin** redirects only, 30s timeout, body ~5MB / 100k characters. HTML is stripped to plain text in the tool. **Images / PDF and other binaries** return HTTP status, `Content-Type`, and size only (body is omitted from the model) so agents can verify downloadable direct links. Optional tool argument `proxy` (e.g. `http://127.0.0.1:7897`); when omitted, process `HTTP_PROXY` / `HTTPS_PROXY` apply (Host spawn installs undici `EnvHttpProxyAgent`). Default UA: `xrk-harness/0.0.4 (+https://github.com/xrkseek)`. Non-2xx still returns the page (not a tool error). Timeouts and provider errors are **transient** and share the LLM-hang settle retry budget (shell `llm/retry` strip).

URLs must be `http`/`https` without credentials. Literal loopback / RFC1918 / link-local are rejected. There is **no** DNS rebinding check; public names that resolve to private IPs are not blocked.

## Browser ops

When web tools are enabled, harness registers `browser_open` / `browser_snapshot` / `browser_act`:

| Tool | Role |
|------|------|
| `browser_open` | Open a URL; return element snapshot with `@eN` refs |
| `browser_snapshot` | Current-page element list (`full=true` adds page text) |
| `browser_act` | `click` / `type` (need `@eN`); **`scroll`** (up/down) · **`press`** (Enter/Tab…) · **`back`** (Hermes-aligned; HTTP snapshot returns `WEB_BROWSER_NO_GRAPHICS` for scroll/press and keeps a history stack for back) |
| `browser_vision` | Screenshot the graphical page for vision (image beside `@eN` text). The HTTP snapshot has no browser and fails; the element list is not a screenshot. **Not** video understanding (use `video_analyze` for video files) |
| `browser_eval` · `browser_wait` · `browser_get` · `browser_find` · `browser_frame` · `browser_tabs` · `browser_cookies` · `browser_hover` · `browser_select` · `browser_forward` · `browser_reload` | Extra tools on graphical agent-browser sessions (beyond the Playwright MCP subset; not registered for HTTP snapshot). Prefer open/snapshot/act/wait for weaker / text-only models; escalate @ref → find → covered → frame → wait → eval → (**multimodal**) vision; text-only soft-degrades `browser_vision`. `browser_get` text/html take optional `selector` (default `body`); tab `label` non-ASCII is slugified; covered/daemon EOF get hints and a short retry |
| `browser_vault_list` | List opaque credential handles (label / origin; **never returns secrets**) |
| `browser_vault_fill` | Fill a snapshot `@eN` field from a handle (server-side type; result is success/handle/origin only) |

The product default session is **agent-browser** ([vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser), Apache-2.0, Rust CLI, actively maintained; still **0.x**, so flag/output churn is possible — this repo pins the npm version). Desktop Host ships the CLI (`XRK_AGENT_BROWSER` overrides). **Chromium is not fully auto-bundled with the npm package**: run `agent-browser install` once (writes `~/.agent-browser/browsers`), or set Settings `executablePath` / `AGENT_BROWSER_EXECUTABLE_PATH`. Defaults: **`headed=true`**, **`restore=true`**; optional `profile` / `proxy` / `autoConnect` / `statePath` for login reuse. Mode / headed / restore / autoConnect apply live from the card. Changing browser Settings recreates live sessions (config fingerprint) so new flags take effect. Upstream config: [agent-browser.dev/configuration](https://agent-browser.dev/configuration). Switch Settings to HTTP snapshot if the CLI is unavailable. Optional **CDP** (`cdpUrl` / `XRK_BROWSER_CDP_URL`). Not desktop computer-use.

The Host (harness/server) shares one `BrowserSession` per conversation session via `createBrowserRuntimeRegistry`, so open pages and CDP callers survive agent invalidate when the product fingerprint is unchanged; browser Settings changes or session finalize / Host stop call `drop`/`dispose`. Tool failures carry `tool/result.error.code` (`WEB_BROWSER_NO_PAGE` · `WEB_BROWSER_NO_GRAPHICS` · `WEB_BROWSER_NO_ATTACHMENTS` · `WEB_BROWSER_BAD_REF` · `WEB_BROWSER_CDP`). `browser_vault_*` is wired by Host injecting Face `listCredentialSlots` / `credentials.peek` into `createBrowserVaultTools` (Hermes opaque-handle subset; origin must match when bound).

## Card replay

`tool/result.meta` carries `card: "web"` so cold history can replay search/fetch cards.
