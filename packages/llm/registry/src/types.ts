export type ProtocolId = "openai-chat";

export type AuthMode = "bearer" | "api-key";

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
  readonly allowDefaultAliases?: boolean;
}

export interface ProviderBinding {
  readonly provider: string;
  readonly protocol: ProtocolId;
  readonly factoryKind: "compat";
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
