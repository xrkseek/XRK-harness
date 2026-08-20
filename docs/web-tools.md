# Web tools

> **读者**：集成者 · 贡献者。

`@xrkseek/exec-web`：`web_search` / `web_fetch`。Harness / server preset 默认登记；minimal 不登记。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | 匿名 HTTP fetch；搜索对齐 XRK-AGT：有密钥用 Tavily/Brave，否则 **parallel-free → duckduckgo** |
| Consumer | `createWebTools(access)` — Face 卡走工具上的 `presentCall` / `presentResult`（`card: "web"`） |

Enablement ≠ provider：工具始终可见。仅当 `XRK_WEB_SEARCH_PROVIDER` 钉了不存在的提供商、或钉了 Tavily/Brave 却没密钥时，`web_search` execute 才回 `isError`。

## Search

| Env | 含义 |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily `POST https://api.tavily.com/search` |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave `GET /res/v1/web/search`（`X-Subscription-Token`） |
| `XRK_PARALLEL_FREE_MCP_URL` | 可选；默认 `https://search.parallel.ai/mcp` |
| `XRK_WEB_SEARCH_PROVIDER` | 可选 `tavily` \| `brave` \| `parallel-free` \| `duckduckgo`。省略时：有 Tavily → Tavily，否则有 Brave → Brave，否则 **parallel-free**；失败自动回退 **duckduckgo**（显式钉住则不回退） |
| `XRK_WEB_SEARCH_REGION` | 可选 DuckDuckGo `kl` 区域（如 `us-en`） |

默认无密钥也能搜（Parallel 免费 MCP；不行再 DDG HTML）。默认最多 **8** 条源。未搬 AGT 全家桶付费商 / SearXNG / Ollama。

## Fetch

始终可用（**不需要 key**）。`GET`、只跟 **同源** 跳转、超时 30s、body 约 5MB / 10 万字符。HTML 在工具侧剥成纯文本。默认 UA：`xrk-harness/0.0.0 (+https://github.com/xrkseek)`。非 2xx 仍返回页面（不是 tool error）。

URL 仅 `http`/`https`，拒凭据。字面量 loopback / RFC1918 / link-local 直接拒绝。**不**做 DNS 再绑定；解析到内网 IP 的公网名拦不住。

## 浏览器操作（尚未）

XRK-AGT 的 `browser_*`（Playwright 会话、snapshot、act）**未**进本仓。当前可读页用 `web_fetch`；交互式浏览器另开切片。

## 卡回放

`tool/result.meta` 带 sources / fetch 摘要；不进 `deriveMessages`。冷 history 靠 Host standing 工具表的 `presentResult`。Face 不按工具名造卡。

相关：[seams.md](./seams.md) · [protocol-events.md](./protocol-events.md) · [profiles.md](./profiles.md)
