---
name: xrk-extensions
description: >-
  Harness 进程插件三种 kind（tools / prompt / commands）契约、createPlugin 形、金样与 reserved 名。
  写 xrk.plugin.json、plugin.mjs 或 extensions 金样时使用。
disable-model-invocation: true
user-invocable: false
---

# 笔记 · 进程插件 kind

真源：[docs/plugin-development.md](../../../docs/plugin-development.md) · 金样：[extensions/example-tools/](../../../extensions/example-tools/)。

## kind 选型

| kind | 返回字段 | 接到 | 典型用途 |
|------|----------|------|----------|
| **`tools`** | `tools: ToolDefinition[]` | ToolRegistry | 模型可调工具 |
| **`prompt`** | `promptSections[]` | SystemPromptAssembler | 追加 system 段（非 inject 行） |
| **`commands`** | `commands[]` | Face `commands/list` · execute | 斜杠 / 命令面 |
| **`xrk.client`**（manifest 扩展） | client 包 | `~/.xrk/plugins/web/` 叠加 | 改产品壳 UI，**不是**进程 kind |

Client 叠加与进程插件可同包发布；见 [community-plugins.md](../../../docs/community-plugins.md)。

## 最小 tools 插件

```text
my-plugin/
  xrk.plugin.json
  plugin.mjs
```

```json
{
  "id": "my-plugin",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

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

`createPlugin()` 返回的 **`id` / `kind` 必须与 manifest 一致**。

## tools 约定

- 工具名：稳定 snake_case；勿与 builtin 同名（builtin 优先，插件不覆盖）。
- `execute(args, signal?)` → `{ content: string, isError?: boolean }`。
- 可选 `presentCall` / `presentResult`（UI 卡片）；见 [docs/tool-pipeline.md](../../../docs/tool-pipeline.md)。
- 并发：可实现 `isConcurrencySafe`（tool 定义级）。

## prompt 约定

- `promptSections`: `{ id, text, order? }[]`。
- **保留 id**（如 `base`）不可被插件覆盖。
- 大段产品上下文应走 **workspace inject**（`agent-instructions`），不是 prompt 插件。

## commands 约定

- 每条：`id` · `title` · `handler` 或等价 Face 契约（见 loader 类型与 Face handlers）。
- 与 workspace **recipes**（`.xrk/recipes/*.yaml`）不同：recipes 是斜杠配方，commands 是插件注册的命令面。

## 适用场景

- 新建 `extensions/example-*` 金样
- 审查用户插件 manifest / entry
- 写 `templates/xrk-harness/recipes/plugin-scaffold*.yaml`

## 非适用场景

- Loader 扫描路径 → **`xrk-plugin-dev`**
- MCP server 进程 → **`xrk-mcp-plugins`**
- 社区 `host.mjs` → **`xrk-community-plugins`**

## 常见陷阱

- 用 `kind: cordis` 期望 Host 自动 DI — **不支持**自动 apply。
- 在插件里 `import` 本仓 `apps/` 私有路径 — **禁止**（extensions 示例应自包含）。
- TypeScript 可选：`src/index.ts` 镜像；**entry 仍指向 `plugin.mjs`**  unless 构建产物明确。

## 相关

- 产品教练：**`xrk-plugin-author`**（种子）  
- 验证清单：**`xrk-plugin-verify`**（种子）
