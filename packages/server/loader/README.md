# @xrkseek/server-loader

进程内插件：`register` / `unregister` / `list` · `discover` / `load` / `loadAll`。

| kind | 接线 |
|------|------|
| `tools` | `wireCompositionTools`（显式同名优先） |
| `prompt` | `wireCompositionPrompts`（保留 id 如 `base` 优先） |

保留未接线：`channel` · `policy` · `llm`。

Manifest：`xrk.plugin.json` 或 `package.json#xrkseek.plugin`。  
规格：[docs/plugin-loader.md](../../../docs/plugin-loader.md) · **文件笔记**：[docs/modules/server-loader.md](../../../docs/modules/server-loader.md)。  
示例：`extensions/example-tools`（`example_ping`）。

Host stop 时 unregister 全部已登记插件（含 `dispose`）。
