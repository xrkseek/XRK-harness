# @xrkseek/exec-web

Web capability seam + model-facing `web_search` / `web_fetch` / `browser_*`.

- **Definition**: `WebSearch` · `WebFetch` · `BrowserSession`
- **Provider**: anonymous HTTP fetch; Tavily / Brave search when a key is set; HTTP browser session via `createHttpBrowserSession`
- **Consumer**: `createWebTools(access)` — Face cards via `presentCall` / `presentResult` (`card: "web"`); `createBrowserTools(session)` — `browser_open` / `browser_snapshot` / `browser_act`

Tools stay registered when search has no key; execute returns `isError` (`WEB_PROVIDER_UNAVAILABLE`). Fetch and browser session reuse the same URL policy. Browser defaults to an HTTP snapshot/act session; Settings → Plugins → **Browser** (or `XRK_BROWSER_CDP_URL`) selects Chrome DevTools.

See [docs/seams.md](../../../docs/seams.md) · [docs/web-tools.md](../../../docs/web-tools.md).
