# example-tools

Sample extension for `@xrkseek/server-loader` discover + **tools auto-wire**.

## Layout

```text
xrk.plugin.json   # id / kind / entry
plugin.mjs        # export createPlugin() with tools[]
src/index.ts      # typed mirror (optional)
```

Contributes `example_ping` → returns `pong`. Host spawn with `XRK_PLUGINS_DIR`
passes plugins into the agent factory; presets call `wireCompositionTools`.

See [docs/plugin-loader.md](../../docs/plugin-loader.md).
