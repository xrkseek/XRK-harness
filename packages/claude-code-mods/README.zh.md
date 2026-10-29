# @xrkseek/claude-code-mods

把 **Claude Code 插件（mods）** 装进本仓：读 `.claude-plugin/plugin.json`、`hooks/hooks.json`，
用原生 ESM 加载钩子模块，把 `register(on)` 收集到的钩子跑成一条中间件链，并按本仓的
工具管线提供 `$`（`$.fs`、`$.store`、`$.session`、`$.tool`…）。

插件作者不需要为本仓改一行代码——写的就是上架 Claude Code 的那份目录。

```
my-plugin/
  .claude-plugin/plugin.json     { "name": "my-plugin", "version": "0.1.0" }
  hooks/hooks.json               { "modules": ["./my-plugin.mjs"] }
  hooks/my-plugin.mjs            export function register(on) { … }
```

## 用法

产品运行时（`core-agent` / `core-tools`，没有 Cordis 容器）用 `createModsRuntime`：

```ts
import { createModsRuntime } from "@xrkseek/claude-code-mods";

const mods = await createModsRuntime({
  services: { fs, subprocess, commands, tools, workingDirectory, storageDomain },
  pipeline, // 本组合现有的 ToolPipeline
  agentOf: ({ call }) => agentForSession(call),
  dirs: ["~/.xrk/plugins/claude-code/my-plugin"],
});

// 工具调用已被拦截（观察 / 拒绝 / 改写）
// 其余事件由宿主在它自己的接缝上派发：
await mods.dispatch("prompt.submit", { text }, () => ({ text }), { agent, signal });

await mods.dispose();
```

Cordis 组合（测试、或已有 Cordis 容器的宿主）用 `attachClaudeCodeMods`：

```ts
import { attachClaudeCodeMods } from "@xrkseek/claude-code-mods";

// pipeline 是本组合现有的 ToolPipeline（presets/harness 里 createToolPipeline 的结果）
const mods = await attachClaudeCodeMods({
  ctx,
  pipeline,
  dirs: ["~/.xrk/plugins/claude-code/my-plugin"],
  agentOf: ({ call }) => agentForSession(call),
});

// 已经生效：插件可以观察、拒绝、改写每一次工具调用
// 其余事件由宿主在它自己的接缝上派发：
await mods.dispatch("prompt.submit", { text, messages }, () => ({ text }), {
  agent,
  signal,
});
```

`definePluginDir(dir)` 单独可用：它把一个插件目录包装成普通的 Cordis 插件（`ctx.plugin(...)`），
用于不想接管工具管线的场合（例如校验、测试、自带管线的宿主）。

## 在产品里的装配

`presets/harness/mods.ts` 是唯一同时知道「工具管线 + 文件系统 + 会话身份」的地方，`createHarnessComposition()`
在它上面做三件事：

1. `createAgent()` 里 `await mods.attach(handle)`——派发 `session.start`，再把包装过的句柄交出去；
2. 包装过的 `continueTurn` / `run`——先 `prompt.submit`（可改写或丢弃这一轮），再 `turn.start`，跑完或抛错都派发 `turn.complete`；
3. `dispose()` 最先 `await mods.dispose()`——`session.end` 读完 `$.state` 之后才拆管线。

插件目录默认 `~/.xrk/plugins/claude-code/<插件名>/.claude-plugin/plugin.json`；
`createHarnessComposition({ claudeCodePluginsRoot })` 可指到别处。目录不存在等同于「没装插件」，组合不付出代价。

组合里的 `$.fs` / `$.process` / `$.store` / `$.session` 用**产品自己的服务**：workspace 根限定的 `fs`、
与 shell 共用的同一个 `subprocess`、插件目录内的 `.state/`、会话 `cwd`。其余服务没组合就按包名拒绝：

| 调用                                  | 产品里的结果                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `$.tool.list`                         | 返回产品注册表的 `name` / `description`（不暴露 `execute`）                    |
| `$.tool.register`                     | 真进产品注册表，名字为 `mcp__<插件>__<工具>`；会话结束撤销                     |
| `$.tool.call`                         | 走产品 `ToolPipeline`（policy / sandbox / 其它插件的 hook 都看得到），只回文本 |
| `$.command.register` / `run` / `list` | 组合自带一张表：进 Face 的 `/` 面板，输入框打 `/name` 也能派发                 |
| `$.ui.ask`                            | 抛（还没有作答面）                                                             |

插件注册的工具名是 `mcp__<插件>__<工具>`（Claude Code 的命名空间约定），产品侧按 `direct` 暴露，
所以模型能直接看到并调用。但它的 `execute` 是占位体（一定 reject）：真正的结果必须由
`on('tool.call', { tool: 'mcp__<插件>__<工具>' }, …)` 那个 hook 回答；链上没人回答时，模型读到的
就是那句「no tool.call hook answered it」——这是可诊断的失败，不是空结果。

**逐条的接入矩阵**（9 个事件 × 36 个 `$` 方法，含「为什么没接」）见
[`docs/claude-code-mods-wiring.md`](../../docs/claude-code-mods-wiring.md)。改任何一方都要同步那张表。

## 事件

| 事件                           | 本仓由谁触发                                                            | 钩子能做                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tool.call`                    | **已接**：`ToolPipeline.onPre` / `onExecute` / `onPost`                 | 观察、`{ deny }` 拒绝、派发前 `{ result }` 直接作答（工具体不跑）、`next` 之后 `{ result }` 改写结果 |
| `session.start`                | **已接**：harness 组合，`createAgent()` 返回前                          | 观察；注册命令与工具                                                                                 |
| `prompt.submit`                | **已接**：harness 组合，`continueTurn` 之前                             | 改写 `text`、追加 `context`、`{ drop }` 丢弃该轮                                                     |
| `turn.start` / `turn.complete` | **已接**：harness 组合，`continueTurn` 前后                             | 观察；`{ text }` 在宿主日志里写一行                                                                  |
| `command.run`                  | **已接**：`$.command.run` 解析名字时；harness 组合在输入框打 `/name` 时 | 以 `{ text }` 或 `{}` 作答                                                                           |
| `ui.render`                    | ✅ AbovePrompt 横幅（`session/band` + `ModBandDock`）                     | 返回 `Box`/`Text`/`Button` 树，或 `next` 让出                                                        |
| `session.end`                  | **已接**：harness 组合，`dispose()` 最先                                | 观察；结束前 `$.state` 仍可读                                                                        |

未接线的事件不是「静默失败」：它们可以被注册，链里永远不触发，加载时会以警告点名——
这和 Claude Code 对未知事件的处理一致。

工具名双向翻译：插件写 `Bash`/`Read`/`Edit`，本仓登记的是 `bash`/`read`/`edit`；
`e.tool` 与 `{ tool: 'Bash' }` 匹配器都走这张表（`tool-names.ts`）。

## `$` 能力面

| 命名空间    | 状态                                                                                                           | 依托                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `$.plugin`  | ✅ `name` / `root`                                                                                             | 插件清单                                                |
| `$.ui`      | ✅ `log` / `toast` / `status` / `invalidate` / `open` / `close` / `panes` / `ask`                              | 宿主日志；`ask` 还需 `userQuestions`                    |
| `$.command` | ✅ `register` / `run` / `list`（**需 `commands` 服务**；harness 组合自带一张，并把它挂到 handle 上给 Face 用） | `ctx.get('commands')`                                   |
| `$.tool`    | ✅ `register` / `call` / `list`                                                                                | `ctx.get('tools')`（产品：真实注册表 + `ToolPipeline`） |
| `$.prompt`  | ✅ `submit`                                                                                                    | `agent.followup()`                                      |
| `$.session` | ✅ `id` / `cwd` / `root` / `model` / `turns` / `messages` / `usage` / `version`                                | `deriveMessages(events)` + `workingDirectory`           |
| `$.state`   | ✅ `get` / `set`                                                                                               | 按会话内存                                              |
| `$.store`   | ✅ `get` / `set` / `delete` / `keys`                                                                           | `storageDomain`（本包自带 `createJsonStorageDomain`）   |
| `$.clock`   | ✅ `now` / `sleep` / `after` / `every`                                                                         | —                                                       |
| `$.fs`      | ✅ `read` / `write` / `list` / `exists` / `stat`                                                               | `@xrkseek/exec-fs`（已限定在 workspace 根内）           |
| `$.process` | ✅ `run`                                                                                                       | `@xrkseek/exec-subprocess`（argv，无 shell）            |
| `$.http`    | ✅ `fetch`                                                                                                     | 进程 `fetch`，正文上限 4 MiB                            |
| `$.env`     | ✅ `get` / `set`                                                                                               | 进程环境变量                                            |

这张表说的是**桥实现了什么**，不是产品组合里每一格都真的能跑——哪些能跑、哪些按服务名拒绝，
见矩阵文档。服务未组合时按包名拒绝；表外的命名空间/方法一律
`no implementation for <namespace>.<method>`——宁可调用点炸，也不让插件读到 `undefined` 后算出错误结论。

**安全边界**：插件以本进程全部权限运行。`$.env` 读写宿主环境变量，`$.http.fetch` 可访问任意 URL，
`$.fs` 与 `$.tool.call` 以会话身份行动。只挂载你愿意当代码运行的插件。

## 与上游桥的差异

本包移植自 DSH 的 `@deepseek-ai/dsh-experimental-claude-code-mods`（v0.2.1-rc.3），
链/引擎/`$` 语义保持一致，差异只在**宿主接缝**和**三处自建依赖**：

| 处                            | 上游                                                           | 本仓                                                                           | 原因                                                                            |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 事件来源                      | Cordis 事件 `agent/created`、`agent/pre-step`、`tools/execute` | `ToolPipeline.onPre/onPost` + 宿主显式 `dispatch`                              | 本仓运行时走 `core-agent` / `core-tools`，不发那三个 Cordis 事件                |
| `$.session.turns`             | `ctx.agents.turnBoundaryOf()`                                  | 派生会话面上 assistant 消息数                                                  | 本仓无 `agents` 服务；`deriveMessages` 是同一份数据                             |
| `$.session.usage` 的 `window` | `tokenMeter.contextPressure()`                                 | `tokenMeter.measure().window`（harness 组合读 `request/header`，其余宿主留空） | DSH 从压力回调里拿；本仓把窗口写在 `request/header`，读得到的就报，读不到才留 0 |
| `$.fs`                        | `dsh-fs` 的 `resolve/readText/listDir`                         | `exec-fs` 的 `resolvePath/read/list`                                           | 本仓 fs 已按 workspace 根限定，路径只解析一次                                   |
| storage domain                | `dsh-storage-domain` 服务                                      | 本包 `storage-domain.ts` + JSON 后端                                           | 本仓尚无该服务；契约保持一致（同步读、异步写）                                  |
| working directory             | `dsh-working-directory`                                        | 本包 `working-directory.ts`（读 `session.header.cwd`）                         | 本仓会话已把它作为绝对路径校验并持久化                                          |
| `ui.render` 横幅              | Remote 流 + 客户端渲染器                                       | `SurfaceTable` + Face `session/band` + 壳 `ModBandDock`                        | Pane 仍诚实降级到横幅                                                           |
| `@Remote({ mode: 'stream' })` | 上游 typert 支持流                                             | `@Remote('watchBand')`                                                         | 本仓 typert 的 `Remote` 只接受名字                                              |

## 测试

63 条，全部跑在自己的 Vento 测试进程里，包括**真实插件目录 + 真实 ToolPipeline**：

```
npx vitest run packages/claude-code-mods/tests
```

- `plugin-dir.test.ts` — 清单解析、路径逃逸拒绝、模块顺序、缺 `register` 拒绝
- `attach.test.ts` — 拒绝 → 工具错误、放行 → 工具体执行、`next` 后改写结果、卸载后管线复原
- `chain.test.ts` / `module.test.ts` / `matcher.test.ts` — 链语义、`next` 单次、超时、错误隔离、`on` 的重复规则
- `define-mod.test.ts` / `testing.test.ts` — 插件包装、测试工具包
- `elements.test.ts` — 横幅元素构造器与序列化

## 环境

- Node ≥ 22（`Promise.withResolvers`、`AbortSignal.any`）
- 本包 tsconfig 的 `lib` 为 `ES2024`，`target` 仍随仓库基线

## 许可

MIT
