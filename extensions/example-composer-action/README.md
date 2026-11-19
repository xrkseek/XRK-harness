# example-composer-action

Native **client** gold sample for XRK-Harness (not a process `tools` plugin, not dsh-compat).

Registers on `conversation.input.right`. The button reads the session standard kit:

| Prop | Source | Use |
|------|--------|-----|
| `useModelSelection` | `@xrkseek/client-ui-model-selection` via `sessions.provide` | Current `provider` / `model` · `groups` |
| `modelSelectionActions` | same | `available` · `select` · `reload`（与座位同路径；子代理 `available=false`） |
| `useInput` | `@xrkseek/client-ui-conversation` | Composer draft text |
| `inputActions.setDraft` | same | Write the draft back |

Click prefixes the draft with `[optimize via <provider>/<model>] ` (local demo only — no LLM call). The button title reports whether `modelSelectionActions.available` is true so authors can see the write face without injecting `ctx.modelDirectories`.

## Layout

```text
package.json      # xrk.client + inject
lib/client.js     # ModuleLoader factory → slots.register
```

## Install

```bash
xrkh plugin add ./extensions/example-composer-action
```

With Host already running, open **Settings → Plugins** and use **Reload** on the row (or wait for soft remount after install). Disable / delete soft-unload the overlay; hard-refresh only if UI stays dark or unload fails.

Monorepo smoke without a global install:

```bash
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --workspace .
```

## Vs process plugins

| Goal | Package |
|------|---------|
| Model-callable tool | `extensions/example-tools` (`kind: tools`) |
| Composer UI control | **this package** (`xrk.client`) |
| Theme token overlay | `extensions/example-theme-tokens` |

Textbook: [docs/client-plugin-development.md](../../docs/client-plugin-development.md) · [docs/plugin-development.md](../../docs/plugin-development.md).
