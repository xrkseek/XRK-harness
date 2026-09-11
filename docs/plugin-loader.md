# 插件加载器

> **读者**：贡献者 · 维护者

在 XRK-Harness 上扩展能力，优先做成插件贡献，再由 preset / Host 接线。

**怎么写、怎么试跑**（最小目录 · CLI · 工作区种子）：[plugin-development.md](./plugin-development.md)。

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
| `commands` | `commands[]` | Face `commands/list` + `commands/execute`（插件名优先于 workspace recipe） |
| `host` | `createPublicHandler(ctx)` | HTTP `tryHandlePublic` 链（SPA 前同源路由；`webServer.register` 形注册，无 Cordis `apply()`） |
| `policy` | `policyRules[]` | `wireCompositionPolicy` → preset `createPolicyEngineFromPlugins`（无显式 engine 时合并） |
| `channel` | `channels[]` | `collectChannelPlugins` · `wireCompositionChannels` · Face `processChannels/list` |
| `llm` | `llmBrands[]` | `wireCompositionLlm` → Host `ProviderRegistry`（显式 brand id 优先；`refreshFacePlugins` 时重入） |

**未做（外置）**：各厂商 IM WS 客户端 · 云端 vision inference · 向量库 embedded host（bridge/sidecar 已能跑，见 [status.md](./status.md)）。

`cordis`：社区 Cordis 宿主包；经 `extensions/dsh-compat` 的 `host.mjs` + 可选 **`cordis-fiber-runner` 子进程**，Face `dynamicCordisRunner/*` 由 `cordis-stub` 转发（见 [community-plugins.md](./community-plugins.md)）。

常量：`PLUGIN_KINDS` · `RESERVED_PLUGIN_KINDS`。

## API

```ts
import {
  createPluginLoader,
  applyToolsPlugins,
  wireCompositionTools,
  wireCompositionPrompts,
  collectPluginCommands,
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

每个插件目录（优先级从上到下）：

**`xrk.plugin.json`**（推荐）

```json
{
  "id": "example-tools",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

或 `package.json` 同形字段：`xrkseek.plugin` · `dsh.plugin` · `deepseek.plugin`（嵌套 `dsh.plugin` / 顶层 `"dsh.plugin"` 均可）。

无上述字段、但 `peerDependencies` / `dependencies` 含 `@xrkseek/cordis` → `kind: "cordis"` stub（`skipLoad`）。

`discover(dir)`：目录自身有 manifest → 单插件；否则扫描一级子目录（`@scope/pkg` 两级）。跳过 `node_modules` / `web` / `client`。

## 模块契约

| Export | 形状 |
|--------|------|
| `createPlugin()` | `() => RegisteredPlugin \| Promise<…>` |
| `default` | 同上 factory |
| `plugin` | `RegisteredPlugin` 常量 |

`id` / `kind` 必须与 manifest 一致（`skipLoad` stub 除外）。

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
  readonly commands?: readonly {
    name: string;
    description: string;
    input?: { hint: string };
    handler(ctx: {
      sessionId: string;
      rawInput: string;
      commandId: string;
    }): { kind: "success" | "error"; text?: string } | Promise<{ kind: "success" | "error"; text?: string }>;
  }[];
  /** `kind: host` — public HTTP before SPA fallback */
  createPublicHandler?: (ctx: {
    pluginsDir?: string;
    xrkHome?: string;
    workspaceRoot?: string;
    defaultCwd?: string;
    resolveSessionCwd?: (sessionId: string) => string | undefined;
    tokenLedger?: {
      aggregateUsage?: (
        query: { days?: number; site?: string },
      ) => Promise<Record<string, unknown> | undefined>;
      fetchBalance?: (
        account?: string,
      ) => Promise<Record<string, unknown> | undefined>;
    };
  }) => (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<boolean>;
  dispose?: () => void | Promise<void>;
}
```

## 示例

`extensions/example-tools` — `kind: tools` → `example_ping`。

`extensions/dsh-compat` — **内置适配层**（`kind: host`，`private` 不入 npm）；`serve` 经 `ensureDshCompatHostPlugin()` 加载本目录，HTTP 实现在 `@xrkseek/server-http/dsh-compat`。

社区 client 包 Host 路由解析顺序（`packages/server/http/src/dsh-compat`）：

1. **全局路径能力表**（`dsh-path-capabilities`）：wallet、sidebar、`/_dsh/`… — **一次挂载，不按包名**
2. 包内 **`xrk.host.json`**（仅 **XRK 自研**扩展需要额外 provider）
3. 无声明时：**`client.js` 扫描** + Cordis `*-settings` 命名约定 → **RPC infer**
4. **`host.mjs` apply bridge**（`webServer.register` · `rpc.register` · `registerUpgrade`）
5. **`cordis-fiber-runner`**（进程内 apply 失败时 fork 子进程 RPC）
6. **honest GET catch-all** — 未入表 GET 仍 JSON
7. `cordis-registry` RPC + POST catch-all（settings fallback）
8. Host `attachExtras` — `attachDshCompatUpgrades`（`prewarmDshCompatAdapters`）

Host 适配层由本仓维护。待补能力（IM 长连接、外部任务流运行时、云端 vision 等）见 [community-plugins.md](./community-plugins.md)「待补」；纯 UI client 通常可加载。

社区包接入层级与 fixture：[community-plugins.md](./community-plugins.md)。

社区 `client.js` 契约形状：[`packages/server/http/src/dsh-compat/README.md`](../packages/server/http/src/dsh-compat/README.md)。

`plugin add` 会复制 `client.js`、可选 **`host.mjs`**、可选 `xrk.host.json` / `package.json`（供 host 字段读取）。

## CLI 安装（`xrkh plugin`）

终端用户 / 全局 CLI 装到 **`~/.xrk/plugins`**（可用 `XRK_HOME` / `XRK_PLUGINS_DIR` 改）。主命令 **`xrkh`**；亦可用 **`xrk-harness`**：

```bash
xrkh plugin add @huanlin/dsh-plugin-spur
xrkh plugin list
xrkh plugin remove @huanlin/dsh-plugin-spur
xrkh plugin path
```

| 子命令 | 作用 |
|--------|------|
| `add <spec…>` | `npm pack` 拉包；识别 `xrk.client`/`dsh.client`（写 `web/` 叠加，inject 里 `@deepseek-ai/dsh-client-*` → `@xrkseek/client-*`）与进程 manifest；client 半部同时复制 **`xrk.host.json`**（或 `package.json` → `xrkseek.host` / `dsh.host`）；若该 id 曾在 Settings 停用，会清 soft-disable 并重写 boot |
| `remove <name…>` | 按 `.xrk-plugins.json` 删文件、清 soft-disable 标记并重写 `web/boot.json`；空 `@scope` 父目录会一并 prune |
| `reconcile` | 以 inventory 为真源：删 `web/plugins` 孤儿目录、重写 `web/boot.json`（跳过 soft-disable；全空则删 boot） |
| `list` / `path` | 清单与根路径（`list` 对停用项附加 `disabled`） |

布局：

```text
~/.xrk/plugins/
  .xrk-plugins.json
  .xrk-plugins-disabled.json   # Settings 软停用 id（可选）
  web/boot.json
  web/plugins/<id>/client.js
  web/plugins/<id>/xrk.host.json   # 可选；Host provider 装配
  <id>/   # 进程插件（discover 跳过 web/）
```

装完后：**进程半部**经 Settings 停用/启用可即时 reconcile；**client 半部**（或新装后首次进壳）仍须刷新页面 / 重启 `web`·`serve`（`needsRestart`）。`add` / `remove` 会自动 reconcile boot；手删目录或 inventory 不同步时跑 `plugin reconcile`。Host 经 Settings 调 mutate 时按序尝试：`XRK_HARNESS_BIN` → 仓内 `apps/cli/dist/bin.js` → `xrkh` → 旧名 `xrk-harness`（仅在命令不存在时回退）。全程 **不用** `shell: true`：`node` + `.js` 直接 argv（兼容 `Program Files` / 含空格或非 ASCII 路径）；Windows 裸 `.cmd` 经 `ComSpec /d /s /c` 正规转义。

**Inventory 与磁盘**：`.xrk-plugins.json` 是 managed 包真源。`web/plugins/<id>/` 仅应存在 inventory 里 `kind: client|both` 的包；孤儿目录会导致 overlay `boot.json` 引用已删 `client.js`，浏览器 boot 失败或 slot 崩溃。`reconcile` 按 inventory 清理 staging 并重写 boot。

**Settings 软停用**：写入 `.xrk-plugins-disabled.json` 后从 `web/boot.json` 去掉该 client 条目。Host 对**进程半部**即时调用 `reconcileManagedProcessPlugins`（停用 unregister、启用再 load；跳过 `mcp:*`；磁盘已删的也卸）。Client 半部仍需浏览器刷新（列表标 `needsRestart`）。`pluginInventory/list` 仍从 inventory 列出停用行（`enabled: false`，并带 `version` / `kind` / `source`），以便再启用。Face 读写优先 Host `hostPublic.pluginsDir`（绝对路径，含 `XRK_PLUGINS_DIR`）。

软停用磁盘契约（`@xrkseek/server-loader` `managed-state`，Face / HTTP / CLI / Host 共用）：

| 规则 | 说明 |
|------|------|
| 真源叶 | 软停用与 inventory 读盘在 loader，避免 Face↔HTTP 环依赖 |
| durable id | inventory 包名；reconcile 规范化别名并剪 orphan |
| 写盘 | boot / inventory / disabled 原子写；内容不变不重写 |
| 进程半部 | Settings 变更后本进程 reconcile；client 仍要刷新页面 |

产品壳 cordis **不会**仅因 `kind:cordis` 变成可管理项。soft-disable market `disabled` 与 soft-disable 列表对齐。

Host 在 `XRK_PLUGINS_DIR` 未设且该目录已存在时自动用作 `pluginsDir`。即便启动时未配置，只要 `{XRK_HOME}/plugins` 已存在，Host 也会按该绝对路径 reconcile 进程插件与 soft-disable。

## Host / preset

`XRK_PLUGINS_DIR`（或存在的 `~/.xrk/plugins`）→ `reconcileManagedProcessPlugins`（discover + load 未停用项）→ factory 收到 `plugins` → minimal / harness 调用 `wireCompositionTools` + `wireCompositionPrompts`；Face 读同一列表做 `pluginInventory/list` 与 slash。Settings 停用/删除/更新后 Host 再跑同一 reconcile，并刷新 Face `plugins`。

`{pluginsDir}/web/`：客户端叠加（可选 `boot.json` + 静态文件）。Host 把它 merge 进产品壳 boot，再 `applyXrkProductBootPolicy`（Cordis 客户端 id 与 HMR 仍会被去掉），并作为 `extraRoots` 提供 `/plugins/…`。不作为进程插件扫描。

```bash
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js serve
```

## 明确不做

- 任意目录 watch / 未声明入口的热重载  
- 浏览器 client 半部热装卸（停用后仍须刷新页面）  
- 未声明入口的任意执行  
- 插件覆盖同名 builtin / 保留 prompt id  
- 保留 kind 的自动接线（先登记，后补 apply*）  
- **不嵌入 Cordis、不执行社区 `apply(ctx)` Host 插件**（设置页列为 `fiberPhase: failed`）。工具/命令请包成 `tools` / `commands` kind。  
- 不把 `plugin` 做成任意 pnpm 透传（`node_modules` 不会被 discover）  

相关：[compose.md](./compose.md) · [learn.md](./learn.md) · [status.md](./status.md) · **[modules/server-loader.md](./modules/server-loader.md)**

---

# Plugin Loader

> **Audience**: Contributors · Maintainers

On XRK-Harness, prefer shipping extensions as plugins, then wire them through presets or the Host.

**How to author and smoke-test** (minimal layout · CLI · workspace seeds): [plugin-development.md](./plugin-development.md).

## Plugin layers

| Layer | Package | Role |
|-------|---------|------|
| Kernel | `@xrkseek/kernel` `definePlugin` | Context DI · events · reversible teardown |
| Compose | `@xrkseek/compose` | Scope · Ordering · isolate |
| Process | `@xrkseek/server-loader` | Directory discovery · kind contributions · Host unload |

## Process plugin kinds

| kind | Contribution | Wiring |
|------|--------------|--------|
| `tools` | `tools[]` | `wireCompositionTools` → ToolRegistry (explicit same-name wins) |
| `prompt` | `promptSections[]` | `wireCompositionPrompts` → SystemPromptAssembler (reserved ids such as `base` win) |
| `commands` | `commands[]` | Face `commands/list` + `commands/execute` (plugin name before workspace recipe) |
| `host` | `createPublicHandler(ctx)` | HTTP `tryHandlePublic` chain (same-origin routes before SPA; `webServer.register`-shaped registration, no Cordis `apply()`) |
| `policy` | `policyRules[]` | `wireCompositionPolicy` → preset `createPolicyEngineFromPlugins` (merged when no explicit engine) |
| `channel` | `channels[]` | `collectChannelPlugins` · `wireCompositionChannels` · Face `processChannels/list` |
| `llm` | `llmBrands[]` | `wireCompositionLlm` → Host `ProviderRegistry` (explicit brand id wins; re-entrant on `refreshFacePlugins`) |

**Not done (external)**: per-vendor IM WS clients · cloud vision inference · embedded vector host (bridge/sidecar works today — [status.md](./status.md)).

`cordis`: community Cordis host packages; wired via `extensions/dsh-compat` `host.mjs` plus optional **`cordis-fiber-runner` subprocess**; Face `dynamicCordisRunner/*` is forwarded by `cordis-stub` (see [community-plugins.md](./community-plugins.md)).

Constants: `PLUGIN_KINDS` · `RESERVED_PLUGIN_KINDS`.

## API

```ts
import {
  createPluginLoader,
  applyToolsPlugins,
  wireCompositionTools,
  wireCompositionPrompts,
  collectPluginCommands,
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

On Host `stop`, each registered plugin is `unregister`ed (including `dispose`).

## Manifest

Per plugin directory (priority top to bottom):

**`xrk.plugin.json`** (recommended)

```json
{
  "id": "example-tools",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

Or equivalent fields in `package.json`: `xrkseek.plugin` · `dsh.plugin` · `deepseek.plugin` (nested `dsh.plugin` or top-level `"dsh.plugin"`).

If those fields are absent but `peerDependencies` / `dependencies` include `@xrkseek/cordis` → `kind: "cordis"` stub (`skipLoad`).

`discover(dir)`: if the directory itself has a manifest → one plugin; otherwise scan one level of children (`@scope/pkg` is two levels). Skips `node_modules` / `web` / `client`.

## Module contract

| Export | Shape |
|--------|-------|
| `createPlugin()` | `() => RegisteredPlugin \| Promise<…>` |
| `default` | Same factory |
| `plugin` | `RegisteredPlugin` constant |

`id` / `kind` must match the manifest (except `skipLoad` stubs).

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
  readonly commands?: readonly {
    name: string;
    description: string;
    input?: { hint: string };
    handler(ctx: {
      sessionId: string;
      rawInput: string;
      commandId: string;
    }): { kind: "success" | "error"; text?: string } | Promise<{ kind: "success" | "error"; text?: string }>;
  }[];
  /** `kind: host` — public HTTP before SPA fallback */
  createPublicHandler?: (ctx: {
    pluginsDir?: string;
    xrkHome?: string;
    workspaceRoot?: string;
    defaultCwd?: string;
    resolveSessionCwd?: (sessionId: string) => string | undefined;
    tokenLedger?: {
      aggregateUsage?: (
        query: { days?: number; site?: string },
      ) => Promise<Record<string, unknown> | undefined>;
      fetchBalance?: (
        account?: string,
      ) => Promise<Record<string, unknown> | undefined>;
    };
  }) => (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<boolean>;
  dispose?: () => void | Promise<void>;
}
```

## Examples

`extensions/example-tools` — `kind: tools` → `example_ping`.

`extensions/dsh-compat` — **built-in adapter** (`kind: host`, `private`, not published to npm); `serve` loads this directory via `ensureDshCompatHostPlugin()`; HTTP lives in `@xrkseek/server-http/dsh-compat`.

Host route resolution order for community client packages (`packages/server/http/src/dsh-compat`):

1. **Global path capability table** (`dsh-path-capabilities`): wallet, sidebar, `/_dsh/`… — **mounted once, not per package name**
2. Package **`xrk.host.json`** (extra providers only for **XRK first-party** extensions)
3. Without a declaration: **`client.js` scan** + Cordis `*-settings` naming → **RPC infer**
4. **`host.mjs` apply bridge** (`webServer.register` · `rpc.register` · `registerUpgrade`)
5. **`cordis-fiber-runner`** (fork subprocess RPC when in-process apply fails)
6. **honest GET catch-all** — unlisted GET still returns JSON
7. `cordis-registry` RPC + POST catch-all (settings fallback)
8. Host `attachExtras` — `attachDshCompatUpgrades` (`prewarmDshCompatAdapters`)

The Host adapter is maintained in this repo. Planned work (IM gateway, external task runtime, cloud Vision, and so on) is listed in [community-plugins.md](./community-plugins.md). Pure UI clients usually load.

Community package tiers and fixtures: [community-plugins.md](./community-plugins.md).

Contract shapes for community `client.js`: [`packages/server/http/src/dsh-compat/README.md`](../packages/server/http/src/dsh-compat/README.md).

`plugin add` copies `client.js`, optional **`host.mjs`**, and optional `xrk.host.json` / `package.json` (for host field reads).

## CLI install (`xrkh plugin`)

End-user / global CLI installs into **`~/.xrk/plugins`** (overridable with `XRK_HOME` / `XRK_PLUGINS_DIR`). Primary command **`xrkh`**; **`xrk-harness`** is equivalent:

```bash
xrkh plugin add @huanlin/dsh-plugin-spur
xrkh plugin list
xrkh plugin remove @huanlin/dsh-plugin-spur
xrkh plugin path
```

| Subcommand | Behavior |
|------------|----------|
| `add <spec…>` | Fetch via `npm pack`; detect `xrk.client`/`dsh.client` (write `web/` overlay; inject remaps `@deepseek-ai/dsh-client-*` → `@xrkseek/client-*`) and process manifests; for the client half also copy **`xrk.host.json`** (or `package.json` → `xrkseek.host` / `dsh.host`); clears a prior Settings soft-disable for that id and rewrites boot |
| `remove <name…>` | Delete per `.xrk-plugins.json` inventory, clear soft-disable markers, and rewrite `web/boot.json`; prune empty `@scope` parents |
| `reconcile` | Inventory as source of truth: remove orphan `web/plugins` dirs, rewrite `web/boot.json` (skip soft-disabled; delete boot when empty) |
| `list` / `path` | Inventory and root path (`list` appends `disabled` for soft-disabled rows) |

Layout:

```text
~/.xrk/plugins/
  .xrk-plugins.json
  .xrk-plugins-disabled.json   # optional Settings soft-disable ids
  web/boot.json
  web/plugins/<id>/client.js
  web/plugins/<id>/xrk.host.json   # optional; Host provider assembly
  <id>/   # process plugins (discover skips web/)
```

After install: the **process half** can live-reconcile on Settings enable/disable; the **client half** (or first shell load after install) still needs a page refresh / restart of `web`·`serve` (`needsRestart`). `add` / `remove` auto-reconcile boot; run `plugin reconcile` when directories were deleted by hand or inventory drifts. Host Settings mutate tries, in order: `XRK_HARNESS_BIN` → repo `apps/cli/dist/bin.js` → `xrkh` → legacy `xrk-harness` (fallback only when the binary is missing). Never uses `shell: true`: `node` + `.js` is a direct argv (safe for `Program Files` / spaces / non-ASCII paths); bare Windows `.cmd` shims go through `ComSpec /d /s /c` with proper quoting.

**Inventory vs disk**: `.xrk-plugins.json` is the source of truth for managed packages. `web/plugins/<id>/` must only hold packages listed as `kind: client|both`; orphans make overlay `boot.json` point at deleted `client.js` and break boot or slots. `reconcile` cleans staging from inventory and rewrites boot.

**Settings soft-disable**: writes `.xrk-plugins-disabled.json` and drops the client entry from `web/boot.json`. Host **live-reconciles** the process half via `reconcileManagedProcessPlugins` (unregister on disable, reload on enable; skips `mcp:*`; also drops plugins removed from disk). The client half still needs a browser refresh (`needsRestart` on the list). `pluginInventory/list` still surfaces the disabled row from inventory (`enabled: false`, plus `version` / `kind` / `source`) so it can be re-enabled. Face I/O prefers Host `hostPublic.pluginsDir` (absolute, including `XRK_PLUGINS_DIR`).

Soft-disable disk contract (`@xrkseek/server-loader` `managed-state`, shared by Face / HTTP / CLI / Host):

| Rule | Meaning |
|------|---------|
| Shared leaf | Soft-disable and inventory reads live in loader (avoids a Face↔HTTP cycle) |
| Durable id | Inventory package name; reconcile canonicalizes aliases and prunes orphans |
| Writes | Atomic boot / inventory / disabled; skip rewrite when content is unchanged |
| Process half | In-process reconcile after Settings mutations; client still needs a page refresh |

Product-shell cordis is **not** managed merely because `kind:cordis`. soft-disable market `disabled` mirrors the soft-disable list.

When `XRK_PLUGINS_DIR` is unset and that directory exists, the Host uses it as `pluginsDir`. Even if unset at spawn, as long as `{XRK_HOME}/plugins` exists the Host reconciles process plugins and soft-disable against that absolute path.

## Host / preset

`XRK_PLUGINS_DIR` (or existing `~/.xrk/plugins`) → `reconcileManagedProcessPlugins` (discover + load non-disabled) → factory receives `plugins` → minimal / harness call `wireCompositionTools` + `wireCompositionPrompts`; Face uses the same list for `pluginInventory/list` and slash commands. After Settings disable/remove/update, the Host runs the same reconcile and refreshes Face `plugins`.

`{pluginsDir}/web/`: client overlay (optional `boot.json` + static files). The Host merges it into the product-shell boot, then `applyXrkProductBootPolicy` (Cordis client ids and HMR are still stripped), and serves `/plugins/…` via `extraRoots`. Not scanned as process plugins.

```bash
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js serve
```

## Explicit non-goals

- Arbitrary directory watch / undeclared-entry hot reload  
- Hot unload/reload of the browser client half (page refresh still required after disable)  
- Arbitrary execution without a declared entry  
- Plugins overriding same-name builtins or reserved prompt ids  
- Auto-wiring reserved kinds (register first; apply* later)  
- **No embedded Cordis; community `apply(ctx)` Host plugins are not executed** (settings UI shows `fiberPhase: failed`). Ship tools/commands as `tools` / `commands` kinds.  
- `plugin` is not an arbitrary pnpm passthrough (`node_modules` is not discovered)  

Related: [compose.md](./compose.md) · [learn.md](./learn.md) · [status.md](./status.md) · **[modules/server-loader.md](./modules/server-loader.md)**
