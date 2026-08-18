# Web tools

`@xrkseek/exec-web`：`web_search` / `web_fetch`。Harness / server preset 默认登记；minimal 不登记。

## 缝

| 层 | 内容 |
|----|------|
| Definition | `WebSearch` · `WebFetch` |
| Provider | 匿名 HTTP fetch；Tavily / Brave search（有密钥时） |
| Consumer | `createWebTools(access)` — Face 卡走工具上的 `presentCall` / `presentResult`（`card: "web"`） |

Enablement ≠ provider：工具始终可见。无搜索密钥时 `web_search` execute 回 `isError` 明文，不假装搜到了。

## Search

| Env | 含义 |
|-----|------|
| `XRK_TAVILY_API_KEY` | Tavily `POST https://api.tavily.com/search` |
| `XRK_BRAVE_SEARCH_API_KEY` | Brave `GET /res/v1/web/search`（`X-Subscription-Token`） |
| `XRK_WEB_SEARCH_PROVIDER` | 可选 `tavily` \| `brave`。省略时：有 Tavily 用 Tavily，否则 Brave |

无密钥：`Error: Web search is not configured. Set XRK_TAVILY_API_KEY or XRK_BRAVE_SEARCH_API_KEY.`  
没有 DuckDuckGo HTML 刮页。默认最多 **8** 条源。

## Fetch

始终可用。`GET`、只跟 **同源** 跳转、超时 30s、body 约 5MB / 10 万字符。HTML 在工具侧剥成纯文本（不是 DSH turndown GFM）。默认 UA：`xrk-harness/0.0.0 (+https://github.com/xrkseek)`。非 2xx 仍返回页面（不是 tool error）。

URL 仅 `http`/`https`，拒凭据。字面量 loopback / RFC1918 / link-local 直接拒绝。**不**做 DNS 再绑定；解析到内网 IP 的公网名拦不住。

## 卡回放

`tool/result.meta` 带 sources / fetch 摘要；不进 `deriveMessages`。冷 history 靠 Host standing 工具表的 `presentResult`。Face 不按工具名造卡。

相关：[seams.md](./seams.md) · [protocol-events.md](./protocol-events.md) · [profiles.md](./profiles.md)
