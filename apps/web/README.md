# @xrkseek/harness-web

**Status:** XRK AppShell（BootComposition + SlotRegistry chrome）— Face console 为 `?console=1` 验证器。

| Layer | Role |
|-------|------|
| AppShell | `BootGate` settle → `chrome.sidebar` / `main` / `status` + `FaceSessionView` |
| Face console | `?console=1` — 单列验证 Host Face RPC / mux |
| Algorithms | `@xrkseek/web-runtime` — BootGate · SlotRegistry · ChunkFold / projections |
| Boot | `window.__DSH_BOOT__` / `__XRK_BOOT__`（默认 `XRK_APP_SHELL_BOOT`） |
| Spec | [docs/learn/xrk-app-shell.md](../../docs/learn/xrk-app-shell.md) · [lc20](../../docs/learn/web-client-algorithms.md) |

## Dev

```bash
# terminal 1 — API + Face (+ optional static)
pnpm --filter @xrkseek/harness-web build
# Windows PowerShell:
$env:XRK_WEB_DIST=(Resolve-Path .\apps\web\dist).Path
# then serve (see apps/cli)

# terminal 2 — Vite HMR (proxies /api)
pnpm --filter @xrkseek/harness-web dev
```

With `XRK_WEB_DIST` set, `serve` hosts the built SPA on the same port and injects boot into `index.html`.

Open `/` for AppShell; `/?console=1` for the Face verifier.

## License / attribution

See [NOTICE](./NOTICE).
