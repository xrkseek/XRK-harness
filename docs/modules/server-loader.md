# Module: `@xrkseek/server-loader`

> **读者**：贡献者 · 维护者

进程插件登记 / 发现 / kind 接线。规格：[plugin-loader.md](../plugin-loader.md)。

## 文件地图

| 文件 | 作用 | 关键契约 |
|------|------|----------|
| `index.ts` | `createPluginLoader` · 导出 | register 冲突抛错；unregister 成对 `dispose`（dispose 抛错仍卸登记） |
| `manifest.ts` | `xrk.plugin.json` / `xrkseek`·`dsh`·`deepseek.plugin` / Cordis stub · 可选 `required` | 只发现不执行；跳过 `web/`；缺 entry 不中断同级 discover |
| `load.ts` | 动态 import · 校验 export 形 | id/kind 与 manifest 一致；`skipLoad` 不 import |
| `load-failures.ts` | `RequiredPluginLoadError` · 可选/必需失败形 | 必需失败才抛；可选记入 `failures[]` |
| `managed-state.ts` | soft-disable · `reconcileManagedProcessPlugins` | 卸载走 unregister；可选 load 失败隔离 |
| `tools.ts` | `applyToolsPlugins` · `wireCompositionTools` | **显式同名优先**（不覆盖） |
| `prompt.ts` | `applyPromptPlugins` · `wireCompositionPrompts` | 保留 id（默认 `base`）优先 |
| `commands.ts` | `collectPluginCommands` | 命令名先登记者赢 |
| `policy.ts` | `wireCompositionPolicy` · `createPolicyEngineFromPlugins` | preset 默认合并 |
| `channel.ts` | `collectChannelPlugins` · `wireCompositionChannels` | Face `processChannels/list` · dsh-compat IM bridge |
| `llm.ts` | `wireCompositionLlm` · `collectLlmBrands` | Registry 显式 id 优先 |
| `inventory.ts` | `toPluginInventoryEntries` | Cordis → `failed` / disabled |

## Kind 表

| kind | 字段 | apply / wire | 状态 |
|------|------|--------------|------|
| `tools` | `tools[]` | `wireCompositionTools` | 能跑 |
| `prompt` | `promptSections[]` | `wireCompositionPrompts` | 能跑 |
| `commands` | `commands[]` | Face `commands/*` | 能跑 |
| `channel` | `channels[]` | `wireCompositionChannels` | 能跑 · discover |
| `policy` | `policyRules[]` | `wireCompositionPolicy` · preset | 能跑 |
| `llm` | `llmBrands[]` | `wireCompositionLlm` · Host spawn | 能跑 |
| `cordis` | — | 不 import | 仅 inventory stub |

纪律：**新 Host 能力先想 kind**，不要只在 Face/Host 写特例。

## 不变量

1. `types.ts` 不 import `prompt.ts`（避免环）。  
2. `tools` / `prompt` / `commands` 判定一律用 `PLUGIN_KINDS.*`。  
3. 插件失败要可逆：`dispose` + unregister（dispose 抛错仍卸登记）。  
4. 可选插件 load 失败不拖垮兄弟；`required: true` 才中止 spawn / reconcile。  
5. MCP Host 接线产出的也是 `kind: "tools"` 插件（见 [server-host.md](./server-host.md)）。  
6. Cordis 包不得 `import()`（避免 `apply(ctx)` 炸 Host）。

## 测试

`packages/server/loader/tests/loader.test.ts` — discover/load · tools · prompt · commands · 别名 · Cordis stub。

---

# Module: `@xrkseek/server-loader`

> **Audience**: Contributors · Maintainers

Process-plugin registration / discovery / kind wiring. Spec: [plugin-loader.md](../plugin-loader.md).

## File map

| File | Role | Critical contract |
|------|------|-------------------|
| `index.ts` | `createPluginLoader` · exports | register conflicts throw; unregister pairs `dispose` (still unregisters if dispose throws) |
| `types.ts` | `RegisteredPlugin` · prompt / command contributions | kind + contribution fields; no cycle back into prompt |
| `kinds.ts` | `PLUGIN_KINDS` · `RESERVED_*` · `isKnownPluginKind` | Prefer a new kind + apply* for new capabilities |
| `manifest.ts` | `xrk.plugin.json` / `xrkseek`·`dsh`·`deepseek.plugin` / Cordis stub · optional `required` | Discover only; skip `web/`; missing entry deferred to load |
| `load.ts` | Dynamic import · export shape checks | id/kind match manifest; `skipLoad` skips import |
| `load-failures.ts` | `RequiredPluginLoadError` · optional/required failure shape | required failures throw; optional → `failures[]` |
| `managed-state.ts` | soft-disable · `reconcileManagedProcessPlugins` | unload via unregister; optional load failures isolated |
| `tools.ts` | `applyToolsPlugins` · `wireCompositionTools` | **Explicit same-name wins** (no silent overwrite) |
| `prompt.ts` | `applyPromptPlugins` · `wireCompositionPrompts` | Reserved ids (default `base`) win |
| `commands.ts` | `collectPluginCommands` | First registered command name wins |
| `policy.ts` | `wireCompositionPolicy` · `createPolicyEngineFromPlugins` | Merged in presets by default |
| `channel.ts` | `collectChannelPlugins` · `wireCompositionChannels` | Face `processChannels/list` · dsh-compat IM bridge |
| `llm.ts` | `wireCompositionLlm` · `collectLlmBrands` | Registry explicit id wins |
| `inventory.ts` | `toPluginInventoryEntries` | Cordis → `failed` / disabled |

## Kind table

| kind | Fields | apply / wire | Status |
|------|--------|--------------|--------|
| `tools` | `tools[]` | `wireCompositionTools` | Working |
| `prompt` | `promptSections[]` | `wireCompositionPrompts` | Working |
| `commands` | `commands[]` | Face `commands/*` | Working |
| `channel` | `channels[]` | `wireCompositionChannels` | Working · discover |
| `policy` | `policyRules[]` | `wireCompositionPolicy` · preset | Working |
| `llm` | `llmBrands[]` | `wireCompositionLlm` · Host spawn | Working |
| `cordis` | — | no import | Inventory stub only |

Discipline: **prefer a new kind for new Host capabilities** instead of Face/Host one-offs.

## Invariants

1. `types.ts` must not import `prompt.ts` (cycle).  
2. `tools` / `prompt` / `commands` checks use `PLUGIN_KINDS.*` only.  
3. Plugin failure must be reversible: `dispose` + unregister (still unregister if dispose throws).  
4. Optional plugin load failures must not take down siblings; only `required: true` aborts spawn / reconcile.  
5. MCP Host wiring also yields `kind: "tools"` plugins (see [server-host.md](./server-host.md)).  
6. Cordis packages must not be `import()`-ed (avoids `apply(ctx)` blowing up Host).

## Tests

`packages/server/loader/tests/loader.test.ts` — discover/load · tools · prompt · commands · aliases · Cordis stub.
