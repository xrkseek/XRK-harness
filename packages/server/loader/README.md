# @xrkseek/server-loader

进程内插件：`register` / `unregister` / `list` · `discover` / `load` / `loadAll`。

`kind: tools` → `tools?: ToolDefinition[]`；用 `applyToolsPlugins` / `wireCompositionTools` 合并进 registry（显式同名优先）。

Manifest：`xrk.plugin.json` 或 `package.json#xrkseek.plugin`。  
见 `docs/plugin-loader.md` · 示例 `extensions/example-tools`（`example_ping`）。

Host stop 时 unregister 全部已登记插件。
