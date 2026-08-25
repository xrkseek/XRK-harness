# Web 工具

> **读者**：集成者 · 贡献者

`@xrkseek/exec-web`：`web_search` / `web_fetch`。Harness / server preset 默认登记；minimal 不登记。  
产品入口 `web` / `serve` 默认 **harness**（见 [profiles.md](./profiles.md)）。

## 产品配置（优先）

| 入口 | 字段 |
|------|------|
| Settings → Plugins → **Web search** | `provider` · `region` · Tavily / Brave 密钥（经 Credentials 落盘） |
| Settings → Credentials | 同槽也可改 Tavily / Brave |

Host 把上述值合成结构化 `webSearch`（`SearchAccessConfig`）传入 `createDefaultWebAccess({ search })`；agent 重建后生效。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | 匿名 HTTP fetch；有密钥用 Tavily/Brave，否则 **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face 卡走 `presentCall` / `presentResult`（`card: "web"`） |

## Headless / CI（可选 env）

| Env | 含义 |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选 Parallel URL |
| `XRK_WEB_SEARCH_PROVIDER` | 钉死提供方（覆盖 Settings） |
| `XRK_WEB_SEARCH_REGION` | DuckDuckGo `kl` |

默认无密钥也能搜（Parallel 免费 MCP；不行再 DDG HTML）。默认最多 **8** 条源。

## Fetch

始终可用（**不需要 key**）。`GET`、只跟 **同源** 跳转、超时 30s、body 约 5MB / 10 万字符。HTML 在工具侧剥成纯文本。默认 UA：`xrk-harness/0.0.4 (+https://github.com/xrkseek)`。非 2xx 仍返回页面（不是 tool error）。

URL 仅 `http`/`https`，拒凭据。字面量 loopback / RFC1918 / link-local 直接拒绝。**不**做 DNS 再绑定；解析到内网 IP 的公网名拦不住。

## 浏览器操作（尚未）

交互式浏览器会话（snapshot、act 等）**未**进本仓。当前可读页用 `web_fetch`；交互式浏览器另开切片。

## 卡回放

`tool/result.meta` 带 `card: "web"`，冷 history 可回放搜索/抓取卡。

---

# Web Tools

> **Audience**: Integrators · Contributors

`@xrkseek/exec-web` provides `web_search` / `web_fetch`. Harness and server presets register them by default; minimal does not. Product entrypoints `web` / `serve` default to **harness** ([profiles.md](./profiles.md)).

## Product configuration (preferred)

| Entry | Fields |
|------|------|
| Settings → Plugins → **Web search** | `provider` · `region` · Tavily / Brave secrets (persisted via Credentials) |
| Settings → Credentials | Same slots may edit Tavily / Brave |

The Host synthesizes a structured `webSearch` (`SearchAccessConfig`) into `createDefaultWebAccess({ search })`; it takes effect after agent rebuild.

## Seams

| Layer | Content |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | Anonymous HTTP fetch; with keys use Tavily/Brave, else **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face cards via `presentCall` / `presentResult` (`card: "web"`) |

## Headless / CI (optional env)

| Env | Meaning |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave |
| `XRK_PARALLEL_FREE_MCP_URL` | Optional Parallel URL |
| `XRK_WEB_SEARCH_PROVIDER` | Pin provider (overrides Settings) |
| `XRK_WEB_SEARCH_REGION` | DuckDuckGo `kl` |

Search works without keys by default (Parallel free MCP, then DDG HTML). Default max sources: **8**.

## Fetch

Always available (**no key required**). `GET`, follow **same-origin** redirects only, 30s timeout, body ~5MB / 100k characters. HTML is stripped to plain text in the tool. Default UA: `xrk-harness/0.0.4 (+https://github.com/xrkseek)`. Non-2xx still returns the page (not a tool error).

URLs must be `http`/`https` without credentials. Literal loopback / RFC1918 / link-local are rejected. There is **no** DNS rebinding check; public names that resolve to private IPs are not blocked.

## Browser ops (not shipped)

Interactive browser sessions (snapshot, act, and similar) are **not** in this repository. Use `web_fetch` for readable pages; interactive browser work is a separate slice.

## Card replay

`tool/result.meta` carries `card: "web"` so cold history can replay search/fetch cards.
