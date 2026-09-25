# Web 工具

> **读者**：集成者 · 贡献者

`@xrkseek/exec-web`：`web_search` / `web_fetch` / `browser_open` · `browser_snapshot` · `browser_act`。Harness / server preset 默认登记；minimal 不登记。  
产品入口 `web` / `serve` 默认 **harness**（见 [profiles.md](./profiles.md)）。

## 产品配置（优先）

| 入口 | 字段 |
|------|------|
| Settings → Plugins → **Web search** | `provider` · `region` · Tavily / Brave 密钥（经 Credentials 落盘） |
| Settings → Plugins → **Browser** | `mode`（`http` 快照 / `cdp`）· `cdpUrl`（Chrome DevTools 地址） |
| Settings → Credentials | 同槽也可改 Tavily / Brave |

Host 把 Web search 合成结构化 `webSearch`（`SearchAccessConfig`）传入 `createDefaultWebAccess({ search })`；Browser 合成 `browserProduct` 传入 `createBrowserSession({ product })`。均在 agent 重建后生效。非空 `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` 为 CI 旁路。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | 匿名 HTTP fetch；有密钥用 Tavily/Brave，否则 **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face 卡走 `presentCall` / `presentResult`（`card: "web"`）；`createBrowserTools(session)` — 交互式会话 |

## Headless / CI（可选 env）

| Env | 含义 |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选 Parallel URL |
| `XRK_WEB_SEARCH_PROVIDER` | 钉死提供方（覆盖 Settings） |
| `XRK_WEB_SEARCH_REGION` | DuckDuckGo `kl` |
| `XRK_WEB_FETCH_ALLOWLIST` | 可选：逗号分隔主机名（支持 `*.example.com`）。非空时 `web_fetch` 仅允许列出主机；空则开放（仍拦私网）。决策写入进程内审计环（`getOutboundAllowlistAuditLog`）；Host 注册 `setOutboundAllowlistAuditObserver`；`xrkh doctor` 显示审计尾。**非** MITM/SOCKS，Starlark execpolicy 后置 |

默认无密钥也能搜（Parallel 免费 MCP；不行再 DDG HTML）。默认最多 **8** 条源。

## Fetch

始终可用（**不需要 key**）。`GET`、只跟 **同源** 跳转、超时 30s、body 约 5MB / 10 万字符。HTML 在工具侧剥成纯文本。默认 UA：`xrk-harness/0.0.4 (+https://github.com/xrkseek)`。非 2xx 仍返回页面（不是 tool error）。

URL 仅 `http`/`https`，拒凭据。字面量 loopback / RFC1918 / link-local 直接拒绝。**不**做 DNS 再绑定；解析到内网 IP 的公网名拦不住。

## 浏览器操作（HTTP 会话）

Harness 在启用 web 工具时登记 `browser_open` / `browser_snapshot` / `browser_act`：

| 工具 | 作用 |
|------|------|
| `browser_open` | 打开 URL，返回带 `@eN` 的元素快照 |
| `browser_snapshot` | 当前页元素列表（`full=true` 附正文） |
| `browser_act` | `click`（跟链 / 提交）或 `type`（填文本框） |
| `browser_vision` | 截当前图形页给 vision（文本 `@eN` 旁加图片）。HTTP 快照没有浏览器时失败，不用元素列表冒充截图 |
| `browser_vault_list` | 列出不透明凭证句柄（label / origin；**永不返回密钥**） |
| `browser_vault_fill` | 用句柄向当前页 `@eN` 字段填密（服务端 type；结果仅 success/handle/origin） |

实现默认是 **HTTP 快照会话**（复用 `WebFetch` + URL 策略），`@eN` 不变。Settings → Plugins → **Browser** 选 CDP 并填 `cdpUrl`（或设 `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL`）时，同一套 `browser_open` / `browser_snapshot` / `browser_act` 改走 Chrome DevTools：浏览器级 websocket 会 `Target.createTarget` + `attachToTarget`，元素来自无障碍树，点击/输入走 `DOM.resolveNode`。`browser_vision` 再调 `Page.captureScreenshot`，经附件库把 PNG 放进模型请求；没接附件库时失败，不把无障碍树当截图。未设地址时不连 CDP。这不是桌面 computer-use。SPA 在纯 HTTP 会话下仍受限；一锤子读页继续用 `web_fetch`。

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
| Settings → Plugins → **Web search** | `provider` · `region` · Tavily / Brave secrets (persisted via Credentials) |
| Settings → Plugins → **Browser** | `mode` (`http` snapshot / `cdp`) · `cdpUrl` (Chrome DevTools URL) |
| Settings → Credentials | Same slots may edit Tavily / Brave |

The Host synthesizes Web search into `webSearch` (`SearchAccessConfig`) for `createDefaultWebAccess({ search })`, and Browser into `browserProduct` for `createBrowserSession({ product })`. Both take effect after agent rebuild. Non-empty `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` is the CI bypass.

## Seams

| Layer | Content |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | Anonymous HTTP fetch; with keys use Tavily/Brave, else **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face cards via `presentCall` / `presentResult` (`card: "web"`); `createBrowserTools(session)` — interactive session |

## Headless / CI (optional env)

| Env | Meaning |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave |
| `XRK_PARALLEL_FREE_MCP_URL` | Optional Parallel URL |
| `XRK_WEB_SEARCH_PROVIDER` | Pin provider (overrides Settings) |
| `XRK_WEB_SEARCH_REGION` | DuckDuckGo `kl` |
| `XRK_WEB_FETCH_ALLOWLIST` | Optional comma-separated hostnames (`*.example.com` ok). When set, `web_fetch` only allows listed hosts; empty stays open (private hosts still blocked). Decisions go to an in-process audit ring (`getOutboundAllowlistAuditLog`); Host registers `setOutboundAllowlistAuditObserver`; `xrkh doctor` shows the audit tail. **not** MITM/SOCKS — Starlark execpolicy deferred |

Search works without keys by default (Parallel free MCP, then DDG HTML). Default max sources: **8**.

## Fetch

Always available (**no key required**). `GET`, follow **same-origin** redirects only, 30s timeout, body ~5MB / 100k characters. HTML is stripped to plain text in the tool. Default UA: `xrk-harness/0.0.4 (+https://github.com/xrkseek)`. Non-2xx still returns the page (not a tool error).

URLs must be `http`/`https` without credentials. Literal loopback / RFC1918 / link-local are rejected. There is **no** DNS rebinding check; public names that resolve to private IPs are not blocked.

## Browser ops (HTTP session)

When web tools are enabled, harness registers `browser_open` / `browser_snapshot` / `browser_act`:

| Tool | Role |
|------|------|
| `browser_open` | Open a URL; return element snapshot with `@eN` refs |
| `browser_snapshot` | Current-page element list (`full=true` adds page text) |
| `browser_act` | `click` (follow links / submit) or `type` (fill a textbox) |
| `browser_vision` | Screenshot the graphical page for vision (image beside `@eN` text). The HTTP snapshot has no browser and fails; the element list is not a screenshot |
| `browser_vault_list` | List opaque credential handles (label / origin; **never returns secrets**) |
| `browser_vault_fill` | Fill a snapshot `@eN` field from a handle (server-side type; result is success/handle/origin only) |

The default is an **HTTP snapshot session** (reuses `WebFetch` + URL policy); `@eN` refs stay. When Settings → Plugins → **Browser** selects CDP with a `cdpUrl` (or `XRK_BROWSER_CDP_URL` / `BROWSER_CDP_URL` is set), the same `browser_open` / `browser_snapshot` / `browser_act` tools use Chrome DevTools: a browser websocket calls `Target.createTarget` + `attachToTarget`, elements come from the accessibility tree, and click/type go through `DOM.resolveNode`. `browser_vision` then calls `Page.captureScreenshot` and stores the PNG so the model request can inline it. With no attachment store the call fails; the accessibility tree is not treated as a screenshot. With no URL, CDP is not contacted. This is not desktop computer-use. SPA pages stay limited on the plain HTTP session; use `web_fetch` for one-shot reads.

The Host (harness/server) shares one `BrowserSession` per conversation session via `createBrowserRuntimeRegistry`, so open pages and CDP callers survive agent invalidate / Settings rebuilds; session finalize or Host stop calls `drop`/`dispose`. Tool failures carry `tool/result.error.code` (`WEB_BROWSER_NO_PAGE` · `WEB_BROWSER_NO_GRAPHICS` · `WEB_BROWSER_NO_ATTACHMENTS` · `WEB_BROWSER_BAD_REF` · `WEB_BROWSER_CDP`). `browser_vault_*` is wired by Host injecting Face `listCredentialSlots` / `credentials.peek` into `createBrowserVaultTools` (Hermes opaque-handle subset; origin must match when bound).

## Card replay

`tool/result.meta` carries `card: "web"` so cold history can replay search/fetch cards.
