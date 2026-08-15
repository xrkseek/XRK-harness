# Plugin loader

进程内插件登记与目录发现（`@xrkseek/server-loader`），以及 **`kind: tools` → Agent registry** 接线。

## API

```ts
import {
  createPluginLoader,
  applyToolsPlugins,
  wireCompositionTools,
} from "@xrkseek/server-loader";
// or from @xrkseek/harness

const loader = createPluginLoader();

// Explicit
loader.register({ id: "my", kind: "tools", tools: [/* ToolDefinition */] });
await loader.unregister("my");

// Discover (scan only — no import)
const hits = await loader.discover("./extensions");

// Import + register one
await loader.load(hits[0]!);

// Discover + load + register all (skip already registered ids)
const ids = await loader.loadAll("./extensions");

const registry = createToolRegistry();
// builtins first…
wireCompositionTools(registry, {
  extraTools: [/* optional explicit extras */],
  plugins: loader.list(),
});
```

合并规则：**显式（builtin / `extraTools`）同名优先** — 插件贡献若撞名则 skip（`explicit_wins`），不 replace。

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

或 **`package.json`**:

```json
{
  "xrkseek": {
    "plugin": {
      "id": "example-tools",
      "kind": "tools",
      "entry": "./plugin.mjs"
    }
  }
}
```

`discover(dir)`：

1. 若 `dir` 自身有 manifest → 单插件  
2. 否则扫描 **一级子目录** 中带 manifest 的项  

`entry` 必须存在；解析为绝对路径。

## 模块契约

Entry 为 ESM，任选其一：

| Export | 形状 |
|--------|------|
| `createPlugin()` | `() => RegisteredPlugin \| Promise<…>` |
| `default` | 同上 factory |
| `plugin` | `RegisteredPlugin` 常量 |

`id` / `kind` 必须与 manifest 一致，否则 `load` 抛错。

```ts
export interface RegisteredPlugin {
  readonly id: string;
  readonly kind: string;
  /** kind === "tools" 时的 ToolDefinition 贡献 */
  readonly tools?: readonly ToolDefinition[];
  dispose?: () => void | Promise<void>;
}
```

`tools[]` 项须含 `name` · `description` · `parameters` · `execute`。

## 示例

仓库内：`extensions/example-tools` — 贡献 `example_ping` → `"pong"`。

## Host / preset wiring

Set `XRK_PLUGINS_DIR` (or `loadHostConfig({ patch: { pluginsDir } })`).  
On `createHostManager().spawn`:

1. `loader.loadAll(pluginsDir)`  
2. `AgentFactory` 收到 `plugins: loader.list()`  
3. `createMinimalComposition` / `createHarnessComposition` / `createServerAgentFactory` 调用 `wireCompositionTools`

`instance.loadedPluginIds` / `health().plugins` 列出已登记 id。

```bash
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js serve
```

Optional preset `policy?: PolicyEngine` → `pipeline.onPre(createPolicyToolPre)`（见 [policy.md](./policy.md)）。

## 明确不做

- 热重载 / watch  
- 未声明入口的任意执行  
- 插件覆盖同名 builtin（显式优先）  
- 非 `tools` kind 的自动接线（其它 kind 仅登记，无贡献协议）

相关：[http-api.md](./http-api.md) · [status.md](./status.md) · CONTRIBUTING「扩展」。
