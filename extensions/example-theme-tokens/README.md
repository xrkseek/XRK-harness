# example-theme-tokens

Native **client** gold sample: restyle the product shell with first-party `ThemeRuntime.overrideTokens` — no dsh-compat, no community skin pack.

Overrides two alias tokens:

- `--dsw-alias-label-primary`
- `--dsw-alias-bg-layer-1`

Both light and dark values are required (ThemeRuntime validates at the boundary).

## Layout

```text
package.json
lib/client.js
```

## Install

```bash
xrkh plugin add ./extensions/example-theme-tokens
```

With Host already running, **Settings → Plugins → Reload** soft-remounts the overlay. Disable / delete soft-unload the override; hard-refresh only if UI stays dark.

## Vs community skins

| Path | When |
|------|------|
| **This package** (`ctx.theme.overrideTokens`) | Small token / palette tweaks; first-party |
| Community skin packs (`/skin-assets`, skin-center, …) | Full artwork skins; Host compat bridge (optional; planned separate npm `@xrkseek/dsh-compat` at 0.9) |

Textbook: [docs/client-plugin-development.md](../../docs/client-plugin-development.md).
