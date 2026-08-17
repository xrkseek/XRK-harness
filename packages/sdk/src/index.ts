/**
 * @xrkseek/harness — stable public SDK surface.
 * Do not deep-import package internals from apps.
 */
export {
  createAgent,
  SessionBusyError,
  NoPendingAdmitError,
  SessionSafetyLimitError,
  type AgentHandle,
  type CreateAgentOptions,
} from "@xrkseek/core-agent";
export {
  runTurn,
  settleToolBatch,
  runCompaction,
  type RunTurnInput,
  type RunTurnResult,
  type ToolSettleMode,
} from "@xrkseek/core-agent-loop";
export {
  ContextOverflowError,
  isContextOverflowError,
  UnsupportedContentError,
  isUnsupportedContentError,
} from "@xrkseek/llm";
export {
  createMemorySessionStore,
  createTurnLatch,
  createSessionDrainLatch,
  createSessionDrainHub,
  createSessionSafety,
  createMistakeTracker,
  createLoopDetectionTracker,
  newSession,
  admitPrompt,
  listPendingAdmits,
  promoteNextAdmit,
  promoteAdmitsForTurn,
  deriveMessages,
  assertModelVisible,
  settleDanglingTools,
  listDanglingToolCalls,
  assertToolCallsSettled,
  TOOL_INTERRUPTED_MESSAGE,
  type SessionStore,
  type TurnLatch,
  type SessionDrainLatch,
  type SessionDrainHub,
  type AdmitReceipt,
  type AdmitPromptOptions,
  type SessionSafetyOptions,
} from "@xrkseek/core-session";
export {
  assembleThreeLayers,
  createSystemPromptAssembler,
  createOutboundPipeline,
} from "@xrkseek/core-system-prompt";
export {
  createToolRegistry,
  createToolPipeline,
  createStdTools,
  materializeTools,
  boundToolOutput,
  createMemoryToolOutputPersist,
  runTool,
  runToolDetailed,
} from "@xrkseek/core-tools";
export { createReplayAdapter } from "@xrkseek/llm-replay";
export { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";
export { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";
export {
  OPENAI_CHAT_BRANDS,
  REGISTRY_FALLBACK_MODEL,
  createProviderRegistry,
  getOpenAiChatBrand,
  resolveLlmFromEnv,
  type BrandEntry,
  type ProviderBinding,
  type ProviderRegistry,
  type ResolveInput,
} from "@xrkseek/llm-registry";
export {
  createPluginLoader,
  applyToolsPlugins,
  wireCompositionTools,
  isToolsPlugin,
  applyPromptPlugins,
  wireCompositionPrompts,
  isPromptPlugin,
  PLUGIN_KINDS,
  RESERVED_PLUGIN_KINDS,
  type RegisteredPlugin,
  type ApplyToolsPluginsResult,
  type ApplyPromptPluginsResult,
} from "@xrkseek/server-loader";
export type { LlmAdapter } from "@xrkseek/llm";
export { loadHostConfig } from "@xrkseek/server-config";
export { createHostManager } from "@xrkseek/server-host";
export { createHttpServer } from "@xrkseek/server-http";
export { createMinimalComposition } from "@xrkseek/preset-minimal";
export { createHarnessComposition } from "@xrkseek/preset-harness";
export {
  createServerAgentFactory,
  createServerComposition,
} from "@xrkseek/preset-server";
export {
  createWorkerCodeRuntime,
  createRunCodeTool,
} from "@xrkseek/code-runtime";
export {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  createWorkspaceToolOutputPersist,
  applyRecipe,
  parseRecipeYaml,
  tryApplySlashRecipe,
  loadOfficeRecipes,
} from "@xrkseek/workspace";
export {
  createPolicyEngine,
  createPolicyEngineFromFile,
  createPolicyEngineFromRuleset,
  createPolicyToolCallGuard,
  createPolicyToolGuard,
  createPolicyToolPre,
  denyToolNames,
  askToolNames,
  assertPolicyAllow,
  loadPolicyRulesetFile,
  parsePolicyRuleset,
  policyRulesetJsonSchema,
} from "@xrkseek/policy";
export {
  createMcpClient,
  registerMcpTools,
  publicToolName,
  parsePublicToolName,
  type McpClient,
  type McpStdioOptions,
} from "@xrkseek/mcp";
export {
  createMemoryAttachmentStore,
  AttachmentError,
  isAttachmentError,
  type AttachmentStore,
} from "@xrkseek/attachment";
export {
  parseSessionEvent,
  assertSessionEvent,
  isValidSessionEvent,
  isSessionEvent,
  sessionEventJsonSchema,
  parsePromptDelivery,
  flattenText,
  contentHasImage,
  asContentBlocks,
  type SessionEvent,
  type MessageContent,
  type ContentBlock,
  type ImageAttachmentRef,
} from "@xrkseek/protocol";
