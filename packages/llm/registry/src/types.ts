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

/** Selectable thinking levels for one brand catalog row (Face ModelSelect). */
export interface BrandModelReasoning {
  readonly efforts: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
  }[];
  readonly defaultEffort?: string;
}

/** One catalog row a brand may advertise (id required; rest optional). */
export interface BrandModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  /** Declared context window (tokens); omit → Face leaves unset. */
  readonly contextWindow?: number;
  /** Declared intake modalities; omit → Face leaves unset (adapter default). */
  readonly inputModalities?: readonly ("text" | "image")[];
  /**
   * Thinking intensity menu (OFM free-lane / community). When set, Face shows
   * ModelSelect levels and openai-compat routes send `reasoning_effort`.
   */
  readonly reasoning?: BrandModelReasoning;
}

/** Brand catalog model: bare id string or a richer entry. */
export type BrandModelSpec = string | BrandModelEntry;

export function brandModelId(spec: BrandModelSpec): string {
  return typeof spec === "string" ? spec.trim() : spec.id.trim();
}

function asBrandModelReasoning(
  raw: BrandModelReasoning | undefined,
): BrandModelReasoning | undefined {
  if (!raw || !Array.isArray(raw.efforts) || raw.efforts.length === 0) {
    return undefined;
  }
  const efforts: BrandModelReasoning["efforts"][number][] = [];
  for (const item of raw.efforts) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const name =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : id;
    const description =
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : undefined;
    efforts.push({
      id,
      name,
      ...(description !== undefined ? { description } : {}),
    });
  }
  if (efforts.length === 0) return undefined;
  const defaultRaw =
    typeof raw.defaultEffort === "string" ? raw.defaultEffort.trim() : "";
  const defaultEffort =
    defaultRaw && efforts.some((effort) => effort.id === defaultRaw)
      ? defaultRaw
      : undefined;
  return {
    efforts,
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
  };
}

export function asBrandModelEntry(spec: BrandModelSpec): BrandModelEntry {
  if (typeof spec === "string") return { id: spec.trim() };
  const contextWindow =
    typeof spec.contextWindow === "number" &&
    Number.isFinite(spec.contextWindow) &&
    spec.contextWindow > 0
      ? Math.floor(spec.contextWindow)
      : undefined;
  const reasoning = asBrandModelReasoning(spec.reasoning);
  return {
    id: spec.id.trim(),
    ...(spec.name?.trim() ? { name: spec.name.trim() } : {}),
    ...(spec.description?.trim() ? { description: spec.description.trim() } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(spec.inputModalities && spec.inputModalities.length > 0
      ? { inputModalities: [...spec.inputModalities] }
      : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

export interface BrandEntry {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: ProtocolId;
  readonly baseUrl?: string;
  readonly path?: string;
  readonly authMode?: AuthMode;
  readonly apiKeyEnv?: string;
  readonly defaultModel?: string;
  /**
   * Optional catalog rows for `autoCatalog` brands. When set (and non-empty),
   * Face lists these instead of a single `defaultModel`. Omit to keep the
   * one-model fallback. Entries may be plain ids or
   * `{ id, name?, contextWindow?, inputModalities?, reasoning? }`.
   */
  readonly models?: readonly BrandModelSpec[];
  readonly notes?: string;
  /**
   * The brand row itself is a complete route (baseUrl + defaultModel, no user
   * profile required). Catalog lists `models` when present, else `defaultModel`
   * alone. Used by bundled providers whose endpoint is decided at runtime; a
   * provider the user must configure first keeps relying on
   * `llm-pi-ai.providers.<id>`.
   */
  readonly autoCatalog?: boolean;
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
