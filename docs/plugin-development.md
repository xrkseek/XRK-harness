# 插件开发

> **读者**：集成者 · 贡献者。

在 XRK-Harness 上扩展能力，优先做成 **进程插件**（`tools` / `prompt` / `commands`），再由 Host discover → preset 接线。客户端壳叠加见文末「client 叠加」。

契约 API 细节：[plugin-loader.md](./plugin-loader.md)。选型：[profiles.md](./profiles.md)。

## 你要做哪一种

| 目标 | kind | 结果 |
|------|------|------|
| 给模型新工具 | `tools` | `ToolDefinition[]` → ToolRegistry |
| 往 system 追加段落 | `prompt` | `promptSections[]` → SystemPromptAssembler |
| 斜杠 / 命令面 | `commands` | Face `commands/list` + `commands/execute` |
| 改产品壳 UI | `xrk.client`（client 包） | `~/.xrk/plugins/web/` 叠加，**不是**进程 kind |

不要在本仓写 **`kind: cordis` 进程包**（只 discover、不自动 `apply`）。装 **DSH 社区 client / `host.mjs` 包**见 [community-plugins.md](./community-plugins.md) · [plugin-loader.md](./plugin-loader.md)。

## 最小进程插件（推荐路径）

目录：

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

仓内金样：[extensions/example-tools](../extensions/example-tools/)。

### 本机试跑

```bash
# 源码仓
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --workspace .

# 或装到用户插件根（装完须 restart 重载 Host）
xrk-harness plugin add ./extensions/example-tools
xrk-harness restart
```

`plugin list` / `plugin path` 看 `~/.xrk/plugins`（可用 `XRK_HOME` / `XRK_PLUGINS_DIR` 改）。

重载：用 **`restart`**（pid 锁停自己的 Host）。`--force` 只杀已识别的 XRK 监听；不会误杀 nginx 等。

### 接线发生在哪

1. Host `loadAll(pluginsDir)` → `RegisteredPlugin[]`  
2. Session 工厂按徽章选 `minimal` / `harness` composition  
3. Composition 调 `wireCompositionTools` / `wireCompositionPrompts`  
4. Face 同一列表做 inventory 与 slash  

同名 builtin / 保留 prompt id **不会**被插件覆盖。

## 工作区喂法（让 Agent 会写插件）

把 [templates/xrk-harness](../templates/xrk-harness/) 同步进 `{workspace}/.xrk`（`assistant.md` / `AGENTS.md`），会话徽章用 **XRK Harness**（`harness`）。之后模型在对话里能读到「怎么写 `xrk.plugin.json`、怎么 `plugin add`、DSH 社区包见 community-plugins」。

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

## Client 叠加（可选）

带 `xrk.client` / `dsh.client` 的包经 `xrk-harness plugin add` 写入 `plugins/web/`，Host merge 进产品壳 boot。改完同样 `restart`。不参与进程 discover（`web/` 被跳过）。

## DSH 社区 client / Host 包

与上文「最小进程插件」不同：npm 上的 DSH 生态包通常带 **`client.js`**（壳 UI）和可选 **`host.mjs`**（同源 HTTP/RPC）。

```bash
xrk-harness plugin add dsh-wallet
xrk-harness plugin add @xmanrui/dsh-im
xrk-harness restart
```

| 文档 | 内容 |
|------|------|
| [community-plugins.md](./community-plugins.md) | 能跑什么、vendor 缺口、27 包 fixture |
| [plugin-loader.md](./plugin-loader.md) | discover · `host.mjs` apply · fiber 子进程 |

实现笔记（维护者）：[`packages/server/http/src/dsh-compat/README.md`](../packages/server/http/src/dsh-compat/README.md)。

## 明确不做

- 热重载 / watch  
- 未声明入口的任意执行  
- 插件覆盖同名 builtin  
- 在本仓实现 **vendor 满血**（官方 IM 消息隧道、TongFlow Python 节点引擎等 — 见 community-plugins「Vendor 缺口」）

相关：[plugin-loader.md](./plugin-loader.md) · [community-plugins.md](./community-plugins.md) · [host-preset.md](./host-preset.md) · [modules/server-loader.md](./modules/server-loader.md)
