# @xrkseek/harness-web

**Status:** AppShell（BootComposition + SlotRegistry）— Face console 为 `?console=1` 验证器。

| Layer | Role |
|-------|------|
| AppShell | `BootGate` → chrome slots + `FaceSessionView` |
| Face console | `?console=1` — Host Face RPC / mux |
| Algorithms | `@xrkseek/web-runtime` |
| Boot | `window.__XRK_BOOT__`（兼认 `__DSH_BOOT__`） |
| Spec | [docs/host-face.md](../../docs/host-face.md) |

## Dev

```bash
pnpm --filter @xrkseek/harness-web build
# PowerShell:
$env:XRK_WEB_DIST=(Resolve-Path .\apps\web\dist).Path
# then serve via apps/cli

pnpm --filter @xrkseek/harness-web dev
```

Open `/` for AppShell；`/?console=1` for Face verifier.

## License / attribution

See [NOTICE](./NOTICE).
