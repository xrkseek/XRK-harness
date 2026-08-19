import type { BrandEntry } from "./types.js";

/** R1 official protocol brands (Anthropic Messages · Gemini · Responses). */
export const R1_PROTOCOL_BRANDS: readonly BrandEntry[] = [
  {
    id: "anthropic",
    displayName: "Anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    path: "/v1/messages",
    authMode: "api-key",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    protocol: "gemini-generate",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    path: "/models",
    authMode: "api-key",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
  },
  {
    id: "openai-responses",
    displayName: "OpenAI Responses",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    path: "/responses",
    authMode: "bearer",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    notes: "OpenAI Responses API (not Chat Completions)",
  },
];

const byId = new Map(R1_PROTOCOL_BRANDS.map((b) => [b.id, b]));

export function getR1Brand(id: string): BrandEntry | undefined {
  return byId.get(id.trim().toLowerCase());
}
