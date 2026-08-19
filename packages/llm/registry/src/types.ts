export type ProtocolId =
  | "openai-chat"
  /** Alias of Chat Completions wire (settings UI name). */
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "gemini-generate";

export type AuthMode = "bearer" | "api-key";

export type FactoryKind =
  | "compat"
  | "anthropic"
  | "responses"
  | "gemini";

export interface BrandEntry {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: ProtocolId;
  readonly baseUrl?: string;
  readonly path?: string;
  readonly authMode?: AuthMode;
  readonly apiKeyEnv?: string;
  readonly defaultModel?: string;
  readonly notes?: string;
}

export interface ResolveInput {
  readonly provider?: string;
  readonly model?: string;
  readonly llm?: string;
  readonly profile?: string;
  readonly defaultProvider?: string;
  /** Override brand baseUrl (required for custom/newapi/cherryin/azure-openai). */
  readonly baseUrl?: string;
  readonly path?: string;
  /** Override brand protocol (Face `llm-pi-ai.providers.*.api`). */
  readonly protocol?: ProtocolId;
  readonly allowDefaultAliases?: boolean;
}

export interface ProviderBinding {
  readonly provider: string;
  readonly protocol: ProtocolId;
  readonly factoryKind: FactoryKind;
  readonly model: string;
  readonly baseUrl: string;
  readonly path: string;
  readonly authMode: AuthMode;
  readonly apiKeyEnv?: string;
  readonly displayName: string;
}

export interface RoutableProvider {
  readonly id: string;
  readonly displayName: string;
  readonly active: boolean;
}

export function normalizeProtocolId(raw: unknown): ProtocolId | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  if (
    key === "openai-chat" ||
    key === "openai-completions" ||
    key === "openai-responses" ||
    key === "anthropic-messages" ||
    key === "gemini-generate"
  ) {
    return key;
  }
  if (key === "openai-compatible" || key === "") return "openai-chat";
  return undefined;
}

export function factoryKindForProtocol(protocol: ProtocolId): FactoryKind {
  switch (protocol) {
    case "anthropic-messages":
      return "anthropic";
    case "openai-responses":
      return "responses";
    case "gemini-generate":
      return "gemini";
    case "openai-chat":
    case "openai-completions":
      return "compat";
  }
}

export function defaultPathForProtocol(protocol: ProtocolId): string {
  switch (protocol) {
    case "anthropic-messages":
      return "/v1/messages";
    case "openai-responses":
      return "/responses";
    case "gemini-generate":
      return "/models";
    case "openai-chat":
    case "openai-completions":
      return "/chat/completions";
  }
}
