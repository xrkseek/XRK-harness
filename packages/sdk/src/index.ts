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
  collectLlmStream,
} from "@xrkseek/llm";
export {
  createMemorySessionStore,
  createPersistentSessionStore,
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
export { createOpenAiResponsesAdapter } from "@xrkseek/llm-openai-responses";
export { createAnthropicAdapter } from "@xrkseek/llm-anthropic";
export { createGeminiAdapter } from "@xrkseek/llm-gemini";
export { createDeepSeekAdapter } from "@xrkseek/llm-deepseek";
export {
  OPENAI_CHAT_BRANDS,
  R1_PROTOCOL_BRANDS,
  DEFAULT_REGISTRY_BRANDS,
  REGISTRY_FALLBACK_MODEL,
  createProviderRegistry,
  getOpenAiChatBrand,
  getR1Brand,
  resolveLlmFromEnv,
  discoverOpenAiChatModels,
  ModelDiscoveryError,
  normalizeProtocolId,
  type BrandEntry,
  type ProtocolId,
  type ProviderBinding,
  type ProviderRegistry,
  type ResolveInput,
  type DiscoveredLlmModel,
} from "@xrkseek/llm-registry";
export {
  createPluginLoader,
  applyToolsPlugins,
  wireCompositionTools,
  isToolsPlugin,
  applyPromptPlugins,
  wireCompositionPrompts,
  isPromptPlugin,
  collectPluginCommands,
  isCommandsPlugin,
  toPluginInventoryEntries,
  PLUGIN_KINDS,
  RESERVED_PLUGIN_KINDS,
  type RegisteredPlugin,
  type PluginCommand,
  type PluginInventoryEntry,
  type ApplyToolsPluginsResult,
  type ApplyPromptPluginsResult,
} from "@xrkseek/server-loader";
export type { LlmAdapter, LlmChatRequest, LlmChatResponse, LlmStreamEvent } from "@xrkseek/llm";
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
  createDefaultWebAccess,
  createWebTools,
  createHttpFetchProvider,
  WEB_SEARCH_MAX_RESULTS,
} from "@xrkseek/exec-web";
export {
  createDefaultLspAccess,
  createLspTools,
  createStdioLspService,
  LSP_PROMPT_TEXT,
} from "@xrkseek/exec-lsp";
export {
  createDefaultPtyAccess,
  createPtyTools,
  createTerminalSessionService,
  PTY_PROMPT_TEXT,
} from "@xrkseek/exec-pty";
export {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  appendWorkspaceInjectsIfChanged,
  createWorkspaceToolOutputPersist,
  applyRecipe,
  parseRecipeYaml,
  tryApplySlashRecipe,
  tryApplySlashSkill,
  createSlashResolver,
  loadOfficeRecipes,
  createSkillTools,
  listSkillsFromWorkspace,
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
  type McpHttpOptions,
  type McpHttpReconnectionOptions,
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
  parseTurnEndCancelCause,
  type SessionEvent,
  type MessageContent,
  type ContentBlock,
  type ImageAttachmentRef,
  type TurnEndReason,
  type TurnEndCancelCause,
  type AgentCancelCause,
} from "@xrkseek/protocol";
