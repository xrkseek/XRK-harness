/**
 * API key validation — twin of `@xrkseek/xrk-llm` `normalizeApiKey` / client `apiKeyFailure`.
 * Face cannot import xrk-llm; keep charset rule in sync with ui-settings-models.
 */

const LEGAL_API_KEY = /^[\x21-\x7E]+$/;

export type ApiKeyRejection = "empty" | "illegalCharacters";

export type ApiKeyCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ApiKeyRejection };

/** Trim and validate a credential before it enters an HTTP header. */
export function normalizeApiKey(raw: string): ApiKeyCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  if (!LEGAL_API_KEY.test(value)) {
    return { ok: false, reason: "illegalCharacters" };
  }
  return { ok: true, value };
}

/** Resolve slot ref for error messages (never echo the secret). */
export function apiKeyRefForProvider(apiKeyEnv?: string): string {
  return apiKeyEnv?.trim() || "stored credential";
}
