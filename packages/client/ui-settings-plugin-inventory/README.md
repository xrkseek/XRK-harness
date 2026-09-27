# @xrkseek/client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

**Plugin list** tab for Web / Desktop Settings. Registers one localized `settings.plugins.tab` contribution with id `all`. Activation does not call Remotes; mounting the tab lazily uses `ctx.remote.pluginInventory.*` through [`api-remotes`](../../api/remotes/README.md).

The tab can **install** (CLI-compatible package spec → `pluginInventory/install`), and for managed rows **update / disable / enable / remove / open folder**. Search and filters stay local. Registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None; this package only surfaces Host inventory in Settings.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or retry** — no Loader subscription; reopen Settings for a fresh list.
- **Client halves** may need a hard refresh after install/update (`needsRestart` when applicable).
