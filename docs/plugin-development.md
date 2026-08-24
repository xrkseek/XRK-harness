# 插件开发 / Plugin Development

> **读者 / Audience**：集成者 · 贡献者 / Integrators · Contributors

在 XRK-Harness 上扩展能力，优先做成 **进程插件**（`tools` / `prompt` / `commands`），再由 Host discover → preset 接线。客户端壳叠加见文末「Client 叠加」。

On XRK-Harness, prefer **process plugins** (`tools` / `prompt` / `commands`), discovered by the Host and wired through presets. Client-shell overlays are covered under “Client overlay” below.

契约 API 细节 / Contract API details：[plugin-loader.md](./plugin-loader.md)。选型 / Profile selection：[profiles.md](./profiles.md)。

## 你要做哪一种 / Which Kind to Choose

| 目标 / Goal | kind | 结果 / Outcome |
|------|------|------|
| 给模型新工具 / New model tools | `tools` | `ToolDefinition[]` → ToolRegistry |
| 往 system 追加段落 / Extra system sections | `prompt` | `promptSections[]` → SystemPromptAssembler |
| 斜杠 / 命令面 / Slash commands | `commands` | Face `commands/list` + `commands/execute` |
| 改产品壳 UI / Product-shell UI | `xrk.client`（client 包 / client package） | `~/.xrk/plugins/web/` 叠加，**不是**进程 kind / Overlay under `web/`, **not** a process kind |

不要在本仓写 **`kind: cordis` 进程包**（只 discover、不自动 `apply`）。装 **社区 client / `host.mjs` 包**见 [community-plugins.md](./community-plugins.md) · [plugin-loader.md](./plugin-loader.md)。

Do not author in-tree **`kind: cordis` process packages** (discover only; no automatic `apply`). For **community client / `host.mjs` packages**, see [community-plugins.md](./community-plugins.md) · [plugin-loader.md](./plugin-loader.md).

## 最小进程插件（推荐路径） / Minimal Process Plugin (Recommended)

目录 / Layout：

```text
my-plugin/
  xrk.plugin.json     # id / kind / entry
  plugin.mjs          # export createPlugin()
```

`xrk.plugin.json`：

```json
{
  "id": "my-plugin",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

`plugin.mjs`：

```js
export function createPlugin() {
  return {
    id: "my-plugin",
    kind: "tools",
    tools: [
      {
        name: "my_ping",
        description: "Returns pong",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: "pong" };
        },
      },
    ],
  };
}
```

仓内金样 / In-repo golden sample：[extensions/example-tools](../extensions/example-tools/)。

### 本机试跑 / Local Smoke Test

```bash
# 源码仓 / From the monorepo
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --workspace .

# 或装到用户插件根（装完须 xrkh restart 重载 Host）
# Or install into the user plugin root (then xrkh restart to reload Host)
xrkh plugin add ./extensions/example-tools
xrkh restart
```

`plugin list` / `plugin path` 看 `~/.xrk/plugins`（可用 `XRK_HOME` / `XRK_PLUGINS_DIR` 改）。

Use `plugin list` / `plugin path` to inspect `~/.xrk/plugins` (overridable with `XRK_HOME` / `XRK_PLUGINS_DIR`).

重载：用 **`restart`**（pid 锁停自己的 Host）。`--force` 只杀已识别的 XRK 监听；不会误杀 nginx 等。

Reload with **`restart`** (pid lock stops this Host). `--force` only stops recognized XRK listeners; it will not kill nginx and similar.

### 接线发生在哪 / Where Wiring Happens

1. Host `loadAll(pluginsDir)` → `RegisteredPlugin[]`  
2. Session 工厂按徽章选 `minimal` / `harness` composition / Session factory picks `minimal` / `harness` by badge  
3. Composition 调 `wireCompositionTools` / `wireCompositionPrompts`  
4. Face 同一列表做 inventory 与 slash / Face uses the same list for inventory and slash  

同名 builtin / 保留 prompt id **不会**被插件覆盖。

Same-name builtins and reserved prompt ids are **not** overridden by plugins.

## 工作区喂法（让 Agent 会写插件） / Workspace Seeds (Teach Agents to Author Plugins)

把 [templates/xrk-harness](../templates/xrk-harness/) 同步进 `{workspace}/.xrk`（`assistant.md` / `AGENTS.md`），会话徽章用 **XRK Harness**（`harness`）。之后模型在对话里能读到「怎么写 `xrk.plugin.json`、怎么 `plugin add`、社区包见 community-plugins」。

Sync [templates/xrk-harness](../templates/xrk-harness/) into `{workspace}/.xrk` (`assistant.md` / `AGENTS.md`) and use the **XRK Harness** session badge (`harness`). The model then sees how to write `xrk.plugin.json`, run `plugin add`, and follow community-plugins for community packages.

```ts
import { createWorkspaceInjector } from "@xrkseek/workspace";
import path from "node:path";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "xrk-harness"));
```

通用办公种子仍用 [templates/office-agent](../templates/office-agent/)。

For a general office persona, keep using [templates/office-agent](../templates/office-agent/).

## Client 叠加（可选） / Client Overlay (Optional)

带 `xrk.client` / `dsh.client` 的包经 `xrkh plugin add` 写入 `plugins/web/`，Host merge 进产品壳 boot。改完同样 `xrkh restart`。不参与进程 discover（`web/` 被跳过）。

Packages with `xrk.client` / `dsh.client` land under `plugins/web/` via `xrkh plugin add`; the Host merges them into the product-shell boot. Restart with `xrkh restart`. They are not process-discovered (`web/` is skipped).

## 社区 client / Host 包 / Community Client and Host Packages

与上文「最小进程插件」不同：社区包通常带 **`client.js`**（壳 UI）和可选 **`host.mjs`**（同源 HTTP/RPC）。

Unlike the minimal process plugin above, community packages usually ship **`client.js`** (shell UI) and optional **`host.mjs`** (same-origin HTTP/RPC).

```bash
xrkh plugin add dsh-wallet
xrkh plugin add @xmanrui/dsh-im
xrkh restart
```

| 文档 / Doc | 内容 / Content |
|------|------|
| [community-plugins.md](./community-plugins.md) | Host 契约 · 已实现 / 待补 · fixture / Host contracts · Implemented / Planned · fixtures |
| [plugin-loader.md](./plugin-loader.md) | discover · `host.mjs` apply · subprocess |

实现笔记 / Implementation notes：[`packages/server/http/src/dsh-compat/README.md`](../packages/server/http/src/dsh-compat/README.md)。

## 明确不做 / Explicit Non-Goals

- 热重载 / watch  
- 未声明入口的任意执行 / Arbitrary execution without a declared entry  
- 插件覆盖同名 builtin / Plugins overriding same-name builtins  
- 在本仓实现全部外部云端满血能力（见 community-plugins「待补 / Planned」） / Full external cloud parity in-tree (see community-plugins Planned)

相关 / Related：[plugin-loader.md](./plugin-loader.md) · [community-plugins.md](./community-plugins.md) · [host-preset.md](./host-preset.md) · [modules/server-loader.md](./modules/server-loader.md)
