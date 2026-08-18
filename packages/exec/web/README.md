# @xrkseek/exec-web

Web capability seam + model-facing `web_search` / `web_fetch`.

- **Definition**: `WebSearch` · `WebFetch`
- **Provider**: anonymous HTTP fetch; Tavily / Brave search when a key is set
- **Consumer**: `createWebTools(access)` — Face cards via `presentCall` / `presentResult` (`card: "web"`)

Tools stay registered when search has no key; execute returns `isError` (`WEB_PROVIDER_UNAVAILABLE`). Fetch is always usable.

See [docs/seams.md](../../../docs/seams.md) · [docs/web-tools.md](../../../docs/web-tools.md).
