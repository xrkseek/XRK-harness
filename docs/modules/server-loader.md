# Module: `@xrkseek/server-loader`

进程插件登记 / 发现 / kind 接线。规格：[plugin-loader.md](../plugin-loader.md)。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | `createPluginLoader` · 导出 | register 冲突抛错；unregister 调 `dispose` |
| `types.ts` | `RegisteredPlugin` · prompt / command 贡献 | kind + 贡献字段；禁止环依赖回 prompt |
| `kinds.ts` | `PLUGIN_KINDS` · `RESERVED_*` · `isKnownPluginKind` | 新能力优先新 kind + apply* |
| `manifest.ts` | `xrk.plugin.json` / `xrkseek`·`dsh`·`deepseek.plugin` / Cordis stub | 只发现不执行；跳过 `web/` |
| `load.ts` | 动态 import · 校验 export 形 | id/kind 与 manifest 一致；`skipLoad` 不 import |
| `tools.ts` | `applyToolsPlugins` · `wireCompositionTools` | **显式同名优先**（不覆盖） |
| `prompt.ts` | `applyPromptPlugins` · `wireCompositionPrompts` | 保留 id（默认 `base`）优先 |
| `commands.ts` | `collectPluginCommands` | 命令名先登记者赢 |
| `inventory.ts` | `toPluginInventoryEntries` | Cordis → `failed` / disabled |

## Kind 表（标准化）

| kind | 字段 | apply / wire | 状态 |
|------|------|--------------|------|
| `tools` | `tools[]` | `wireCompositionTools` | 能跑 |
| `prompt` | `promptSections[]` | `wireCompositionPrompts` | 能跑 |
| `commands` | `commands[]` | Face `commands/*` | 能跑 |
| `channel` | （未定） | — | 保留 |
| `policy` | （未定） | — | 保留 |
| `llm` | （未定） | — | 保留 |
| `cordis` | — | 不 import | 仅 inventory stub |

纪律：**新 Host 能力先想 kind**，不要只在 Face/Host 写特例。

## 不变量

1. `types.ts` 不 import `prompt.ts`（避免环）。  
2. `tools` / `prompt` / `commands` 判定一律用 `PLUGIN_KINDS.*`。  
3. 插件失败要可逆：`dispose` + unregister。  
4. MCP Host 接线产出的也是 `kind: "tools"` 插件（见 [server-host.md](./server-host.md)）。  
5. Cordis 包不得 `import()`（避免 `apply(ctx)` 炸 Host）。

## 测试

`packages/server/loader/tests/loader.test.ts` — discover/load · tools · prompt · commands · dsh/deepseek 别名 · Cordis stub。
