export type {
  AuthMode,
  BrandEntry,
  FactoryKind,
  ProtocolId,
  ProviderBinding,
  ResolveInput,
  RoutableProvider,
} from "./types.js";
export {
  defaultPathForProtocol,
  factoryKindForProtocol,
  normalizeProtocolId,
} from "./types.js";
export {
  OPENAI_CHAT_BRANDS,
  getOpenAiChatBrand,
} from "./brands-openai-chat.js";
export { R1_PROTOCOL_BRANDS, getR1Brand } from "./brands-r1.js";
export {
  DEFAULT_REGISTRY_BRANDS,
  REGISTRY_FALLBACK_MODEL,
  createProviderRegistry,
  type CreateProviderRegistryOptions,
  type ProviderRegistry,
} from "./registry.js";
export { resolveLlmFromEnv } from "./from-env.js";
export {
  discoverOpenAiChatModels,
  ModelDiscoveryError,
  type DiscoverModelsRequest,
  type DiscoveredLlmModel,
} from "./discover.js";
export {
  createRoutingLlmAdapter,
  isRoutingLlmAdapter,
  type CreateRoutingLlmAdapterOptions,
  type LlmRouteSelection,
  type RoutingLlmAdapter,
} from "./routing-adapter.js";
