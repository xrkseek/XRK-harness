# Claude Code 插件：接入到什么程度

这份表是「插件能不能用」的唯一清单。改任何一方（`packages/claude-code-mods`、`presets/harness/mods.ts`、产品服务）
都要同步这里，否则下一个人会以为某个格子是接好的。

三个入口，能力面不同：

| 入口                                                       | 谁在用                                             | 说明                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `attachClaudeCodeMods({ ctx, … })`                         | Cordis 组合（`packages/stubs/*` 那一套、测试对照） | 有 `ctx.get(...)` 服务表，事件靠 Cordis 的 `agent/created` / `agent/disposed` 派发 |
| `createModsRuntime({ services, pipeline, agentOf, dirs })` | **产品**（`presets/harness/mods.ts` 用它）         | 无 Cordis；`createServiceContext` 只补 `get` / `logger` / `effect` 三人件          |
| `definePluginDir(dir)`                                     | 只要目录加载，不要事件                             | 单独把 `.claude-plugin` 目录包成 Cordis 插件                                       |

产品真正的组装点是 `presets/harness/mods.ts` 的 `createHarnessMods()`，`createHarnessComposition()` 调它。

## 事件

| 事件            | 产品里有派发点吗                                 | 说明                                                                                                                                   |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tool.call`     | ✅ `ToolPipeline.onPre` / `onExecute` / `onPost` | 派发前 `{ result }` 直接作答并**跳过工具体**；`{ deny }` 拒绝；`next` 之后 `{ result }` 改写模型读到的内容。已答过的调用不再派发第二次 |
| `session.start` | ✅ `createAgent()` 返回前                        | 插件在这里注册命令/工具，宿主 await 它，所以第一次提示词进来时注册已完成                                                               |
| `prompt.submit` | ✅ `continueTurn` 之前                           | 改写 `text`、`{ drop }` 丢掉这一轮。`context`（模型可见、用户不可见的文本）**本组合没有接缝**，返回了会写一条诊断后丢弃                |
| `turn.start`    | ✅ `continueTurn` 之前                           | 观察                                                                                                                                   |
| `turn.complete` | ✅ 回答与抛错两条路径                            | 抛错时 `reason: 'error'`，插件不会看到「开始了却永不结束」的轮次                                                                       |
| `session.end`   | ✅ `dispose()` 最先                              | 此时 `$.state` / `$.store` 仍可读                                                                                                      |
| `command.run`   | ✅                                               | 两条入口都到：`$.command.run` 解析名字时派发；输入框打 `/name` 时由 Face 的 `executeFaceCommand` 末段转到这里（见下）                  |
| `ui.render`     | ✅ `SurfaceTable` / `pluginBand`                 | 产品 `createModsRuntime` 在 AbovePrompt 槽派发；Face 推 `session/band`，壳画树并回传 `session.pressBand`                               |

未派发的事件**不是静默失败**：可以注册，链里永不触发，加载时以警告点名（与 Claude Code 对未知事件的态度一致）。
主动调用另有办法表态：`ui.open` 直接返回 `isPlaced: false`，`$.command.register` 注册后立刻能在 `$.command.list` 里查到。

## `$` 能力面

依托列写的是产品 harness 组合里实际接的那个服务。

| 方法                                               | 状态                                   | 依托                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$.ui.log` / `toast` / `status`                    | ✅                                     | 宿主 logger（preset 里落到 `console.warn`）                                                                                                          |
| `$.ui.invalidate` / `close`                        | ✅ 触发重画                            | `redraw` → `SurfaceTable.refresh`；壳经 `session/band` 收到新树                                                                                      |
| `$.ui.open`                                        | ⚠️ 诚实降级                            | 返回 `{ id, isPlaced: false, reason: 'this host places no panes; draw in AbovePrompt' }`（无 pane，画在横幅）                                        |
| `$.ui.panes`                                       | ⚠️ `[]`                                | 没有 pane 系统；AbovePrompt 横幅已接                                                                                                                 |
| `$.ui.ask`                                         | ✅                                     | Host 把 Face `FaceQuestionBroker` 填进 `createModsRuntime({ services.userQuestions })`（与 `ask_user` 同一作答面）；未接线的组合仍抛「needs a userQuestions service」 |
| `$.command.register`                               | ✅ 桥自己的命令表                      | `commandsFacade`（`presets/harness/mods.ts`）：注册即生效，`argumentHint` 走 `input.hint`                                                            |
| `$.command.list`                                   | ✅                                     | 同一张表                                                                                                                                             |
| `$.command.run`                                    | ✅                                     | 解析 `/name args` → 写 `command/run` + `command/done` → 调 handler → 派发 `command.run` 给注册它的插件                                               |
| `$.tool.register`                                  | ✅                                     | 真进产品 `ToolRegistry`，名字 `mcp__<插件>__<工具>`；会话结束撤销                                                                                    |
| `$.tool.call`                                      | ✅                                     | 走产品 `ToolPipeline`（policy / sandbox / 其它插件的 hook 都看得到），只回文本                                                                       |
| `$.tool.list`                                      | ✅                                     | 产品注册表的 `name` / `description`（不给 `execute`）                                                                                                |
| `$.prompt.submit`                                  | ✅                                     | `agent.admit()` —— 记录一条用户消息但不启动轮次                                                                                                      |
| `$.session.id`                                     | ✅                                     | 会话 id                                                                                                                                              |
| `$.session.cwd` / `root`                           | ✅                                     | `session.header.cwd`（= 组合的 workspaceRoot）                                                                                                       |
| `$.session.model`                                  | ✅                                     | 组合的 `llm.id`                                                                                                                                      |
| `$.session.turns`                                  | ✅                                     | `deriveMessages()` 里 assistant 消息数                                                                                                               |
| `$.session.messages`                               | ✅                                     | 产品自己的 `deriveMessages(events)` —— 模型看到的就是插件看到的（含 compaction 折叠）                                                                |
| `$.session.usage`                                  | ✅                                     | `tokens` 从 `assistant/message` 的 `usage` 累加（无样本时缺席而不是 0）；`window` 从 `request/header` 的 `config.contextWindow` 读，没有请求时才留 0 |
| `$.session.version`                                | ✅                                     | `MODS_API_VERSION`（桥的 API 版本，不是会话格式版本）                                                                                                |
| `$.store.get` / `set` / `delete` / `keys`          | ✅                                     | JSON 域，落在 `<pluginsRoot>/.state/`                                                                                                                |
| `$.fs.read` / `write` / `list` / `exists` / `stat` | ✅                                     | `@xrkseek/exec-fs`，已限定在 workspace 根内                                                                                                          |
| `$.process.run`                                    | ✅                                     | `@xrkseek/exec-subprocess`，与 shell 工具**同一个实例**                                                                                              |
| `$.http.fetch`                                     | ✅                                     | 进程 `fetch`，正文上限 4 MiB                                                                                                                         |
| `$.env.get` / `set`                                | ✅                                     | 进程环境变量                                                                                                                                         |

这三个不走服务表，由桥自己实现，任何组合里都一样：

| 方法                                        | 状态 | 说明                                     |
| ------------------------------------------- | ---- | ---------------------------------------- |
| `$.plugin.name` / `root`                    | ✅   | 插件清单与目录                           |
| `$.state.get` / `set`                       | ✅   | 按会话的内存态（`session.end` 时仍可读） |
| `$.clock.now` / `sleep` / `after` / `every` | ✅   | 定时器随会话作用域撤销                   |

服务没组合时按包名拒绝（`needs a <service> …`），表外的命名空间/方法一律 `no implementation for <ns>.<method>`。

## 已接完的产品缝

`ui.render` + 横幅：`createModsRuntime` 内 `SurfaceTable` 派发；`wrap()` 挂 `pluginBand`；Face 推
`session/band`、应答 `session.pressBand`；壳 `ModBandDock` 画 `Box`/`Text`/`Button` 并回传点击。
`session.start.surface` 现为 `"web"`。

`$.ui.ask`：Face `FaceQuestionBroker` + 壳 `QuestionComposer`；Host 注入 `userQuestions`，
`session.start.isInteractive` 随之变真。

其余 op 与事件在产品组合里都是真接的，靠的是
`presets/harness/mods.ts` 里的适配器（`toolsFacade` / `commandsFacade` / `transcriptOf` / `tokenMeter` / `userQuestions` / band）。

## 插件命令怎么走到输入框

三个新接口，都不依赖 Cordis：

- `PluginCommandSource`（`packages/core/agent`）—— `list()` + `execute(line)`，挂在 `AgentHandle.pluginCommands` 上。
  放在 core 而不是插件包里，Face 才能读它而不依赖 mods 桥。
- `mods.wrap(handle)` 用 `Object.defineProperty` 把 `commandsFacade` 的这一份表挂上去（一次性，不可重绑）。
- Face 两处读它：`listFaceCommandDescriptors(loadRecipes, plugins, extras)` 把插件命令并进 `/` 面板；
  `executeFaceCommand` 在 builtin 与 process 插件都没命中后问它一次。

生命周期**只有一份**：`commandsFacade.execute` 自己写 `command/run` + `command/done` 并回 `commandId`
（与 DSH `commands.execute` 同签名），Face 拿到只转发 id、不再记第二对。所以插件内部调 `$.command.run`
与用户敲 `/name` 在会话日志里留下等量事件——不会一边有记录一边没有。

优先级是**内置 > process 插件 > 插件命令 > recipe**：插件不能顶掉 `/compact`，也不该顶掉用户自己写的
`/some-recipe` 模板。名字不合法（非 `[a-z][a-z0-9_-]*`）直接丢弃，不报错——与 Face 对插件命令的既有态度一致。

## 怎么验证

```bash
npx vitest run packages/claude-code-mods/tests presets/harness/tests
```

- `packages/claude-code-mods/tests/*`：引擎语义（链、`next` 单次、超时、错误隔离、目录加载、`$` 面）
- `presets/harness/tests/claude-code-mods.test.ts`：**真实组合 + 真实插件目录**，端到端证明
  提示词改写、工具拒绝、插件工具的注册→作答→回调闭环、`session.messages` 折出上一轮、`session.end` 时机
