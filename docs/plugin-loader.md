# Plugin loader

进程内插件登记与目录发现（`@xrkseek/server-loader`）。**能力优先做成插件贡献**，再由 preset / Host 接线——不要为每个新能力单独开 Host 特例。

## 两层插件

| 层 | 包 | 作用 |
|----|-----|------|
| Kernel | `@xrkseek/kernel` `definePlugin` | Context DI · 事件 · 可逆 teardown |
| Compose | `@xrkseek/compose` | Scope · Ordering · isolate |
| Process | `@xrkseek/server-loader` | 目录发现 · kind 贡献 · Host 卸载 |

## Kind（进程插件）

| kind | 贡献 | 接线 |
|------|------|------|
| `tools` | `tools[]` | `wireCompositionTools` → ToolRegistry（显式同名优先） |
| `prompt` | `promptSections[]` | `wireCompositionPrompts` → SystemPromptAssembler（`base` 等保留 id 优先） |

保留（可发现、尚未自动接线）：`channel` · `policy` · `llm`。

常量：`PLUGIN_KINDS` · `RESERVED_PLUGIN_KINDS`。

## API

```ts
import {
  createPluginLoader,
  applyToolsPlugins,
  wireCompositionTools,
  wireCompositionPrompts,
  PLUGIN_KINDS,
} from "@xrkseek/server-loader";

const loader = createPluginLoader();
loader.register({ id: "my", kind: "tools", tools: [/* ToolDefinition */] });
await loader.unregister("my");

const hits = await loader.discover("./extensions");
await loader.load(hits[0]!);
const ids = await loader.loadAll("./extensions");

wireCompositionTools(registry, {
  extraTools: [/* optional */],
  plugins: loader.list(),
});
wireCompositionPrompts(prompts, {
  plugins: loader.list(),
  reservedIds: ["base"],
});
```

Host `stop` 会对已登记插件逐个 `unregister`（含 `dispose`）。

## Manifest

每个插件目录：

**`xrk.plugin.json`**（推荐）

```json
{
  "id": "example-tools",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

或 **`package.json`** 的 `xrkseek.plugin` 字段。

`discover(dir)`：目录自身有 manifest → 单插件；否则扫描一级子目录。

## 模块契约

| Export | 形状 |
|--------|------|
| `createPlugin()` | `() => RegisteredPlugin \| Promise<…>` |
| `default` | 同上 factory |
| `plugin` | `RegisteredPlugin` 常量 |

`id` / `kind` 必须与 manifest 一致。

```ts
export interface RegisteredPlugin {
  readonly id: string;
  readonly kind: string;
  readonly tools?: readonly ToolDefinition[];
  readonly promptSections?: readonly {
    id: string;
    order?: number;
    content: string | (() => string | Promise<string>);
  }[];
  dispose?: () => void | Promise<void>;
}
```

## 示例

`extensions/example-tools` — `kind: tools` → `example_ping`。

## Host / preset

`XRK_PLUGINS_DIR` → `loadAll` → factory 收到 `plugins` → minimal / harness 调用 `wireCompositionTools` + `wireCompositionPrompts`。

```bash
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js serve
```

## 明确不做

- 热重载 / watch  
- 未声明入口的任意执行  
- 插件覆盖同名 builtin / 保留 prompt id  
- 保留 kind 的自动接线（先登记，后补 apply*）

相关：[compose.md](./compose.md) · [learn.md](./learn.md) · [status.md](./status.md)
