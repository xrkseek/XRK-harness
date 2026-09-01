# TOOLS

「有什么函数」≠「像谁」。人格在 `IDENTITY` / `SOUL`；工具表靠挂载。

| 优先 | 路径 | 何时 |
|------|------|------|
| **1** | **设置 → 插件 → 插件配置 → MCP** | 已有 / 可起 MCP 服务器（stdio `command`+`args` 或 `url`） |
| **2** | `extensions/<id>/` + `kind: tools` | 仓库内简单自有 JS，不值得起 MCP 进程 |
| **3** | `kind: prompt` · `commands` · `xrk.client` | 追加说明、斜杠、改壳 UI |

- MCP：Save 后本进程 remount（文件真源）；开 **允许连接** 才会真正挂工具；policy deny → **park**。
- 进程插件：`xrkh plugin add` 后必须 **`xrkh restart`**（或停再起 `web`）。
- 剧本：skill **`xrk-capability-attach`**（默认）· **`xrk-plugin-kind`** · **`xrk-plugin-author`** · **`xrk-plugin-verify`**。
