# @xrkseek/harness

稳定 **公共 SDK** 面。应用与示例应依赖本包，避免深链 `@xrkseek/core-*` 内部路径（类型/测试除外）。

包名：`@xrkseek/harness`（源：`packages/sdk`）。

## 快速示例

```ts
import {
  createMinimalComposition,
  createReplayAdapter,
} from "@xrkseek/harness";

const composition = createMinimalComposition({
  workspaceRoot: process.cwd(),
  llm: createReplayAdapter([{ content: "pong" }]),
});
const agent = await composition.createAgent();
const result = await agent.continueTurn({ text: "ping" });
console.log(result.text);
```

HTTP：`createHostManager` + `loadHostConfig` + preset factory — 见 CLI `serve` 与 [docs/http-api.md](../../docs/http-api.md)。

## 导出地图（按域）

| 域 | 符号（摘） |
|----|------------|
| Agent | `createAgent` · `AgentHandle` · `SessionBusyError` · `SessionSafetyLimitError` |
| Loop | `runTurn` · `settleToolBatch` · `runCompaction` |
| Session | `createMemorySessionStore` · `createJsonlSessionStore` · `has` · `newSession` · `admitPrompt` · `promoteAdmitsForTurn` · `deriveMessages` · latches · safety · dangling |
| Protocol | `parseSessionEvent` · `sessionEventJsonSchema` · `parsePromptDelivery` |
| Tools | `createToolRegistry` · `createToolPipeline` · `createStdTools` · `materializeTools` · `boundToolOutput` · `runTool` |
| Web | `createWebTools` · `createDefaultWebAccess` · `createHttpFetchProvider` |
| LSP | `createLspTools` · `createDefaultLspAccess` · `createStdioLspService` |
| PTY | `createPtyTools` · `createDefaultPtyAccess` · `createTerminalSessionService` |
| Prompt | `assembleThreeLayers` · `createSystemPromptAssembler` · `createOutboundPipeline` |
| LLM | `LlmAdapter` · `stream()` · `createReplayAdapter` · `createOpenAiCompatibleAdapter` · `createDeepSeekAdapter` · `collectLlmStream` |
| Plugins | `createPluginLoader` · `wireCompositionTools` / `Prompts` · `collectPluginCommands` · `PLUGIN_KINDS` |
| Workspace | `createWorkspaceInjector` · `resolveWorkspaceInject` · `createWorkspaceToolOutputPersist` · recipes · `createSlashResolver` · `createSkillTools` · `listSkillsFromWorkspace` |
| Policy | `createPolicyEngine` · ruleset file load · `createPolicyToolPre` / `Guard` · `denyToolNames` |
| MCP | `createMcpClient` · `registerMcpTools` · `publicToolName`（默认 deny；可 watch list_changed） |
| Presets | `createMinimalComposition` · `createHarnessComposition` · `createServerComposition` / `createServerAgentFactory` |
| Server | `loadHostConfig` · `createHostManager` · `createHttpServer` |
| Code | `createWorkerCodeRuntime` · `createRunCodeTool` |

完整列表以 `packages/sdk/src/index.ts` 为准。

## 非目标

- 不把 MCP 宣传成 Face 设置 UI / 进程 supervisor；DeepSeek 包为 openai-compatible 预设（无独立 body 分叉）  
- 不替代 CLI；CLI 在 `@xrkseek/harness-cli`  

## 文档

[docs/README.md](../../docs/README.md) · [docs/status.md](../../docs/status.md) · [docs/architecture.md](../../docs/architecture.md)
