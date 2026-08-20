# Web tools

> **读者**：集成者 · 贡献者。

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
| Consumer | `createWebTools(access)` — Face 卡走工具上的 `presentCall` / `presentResult`（`card: "web"`） |

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

XRK-AGT 的 `browser_*`（Playwright 会话、snapshot、act）**未**进本仓。当前可读页用 `web_fetch`；交互式浏览器另开切片。

## 卡回放

`tool/result.meta` 带 `card: "web"`，冷 history 可回放搜索/抓取卡。
