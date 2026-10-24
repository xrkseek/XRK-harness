// Pure string scrubber only: the package ROOT wires the OS keyring store and
// must never reach a browser bundle (see the `xrk-client-bundle-purity` gate).
import { redactSecrets } from '@xrkseek/secrets/redact'

/** Stable fallbacks when the durable message is empty or adapter-prefixed only. */
const CODE_FALLBACK: Readonly<Record<string, string>> = {
  AUTH: 'API key is invalid',
  REGION: 'This model is not available in your region',
  PROVIDER_DENIED: 'This model is not available for this client or plan',
  FORBIDDEN: 'Provider refused this request',
  RATE_LIMIT: 'Rate limited — try again shortly',
  QUOTA: 'Provider quota exceeded',
  INVALID_REQUEST: 'Provider rejected the request',
}

const ADAPTER_PREFIX_RE =
  /^(?:openai-compatible|anthropic|gemini|openai-responses|deepseek)(?:\s+(?:HTTP\s+\d+|chat error|stream error)):\s*/i

/** Drop adapter label / HTTP status prefix so the GUI shows the provider sentence. */
function stripAdapterPrefix(message: string): string {
  return message.replace(ADAPTER_PREFIX_RE, '').trim()
}

/**
 * Convert a durable failure into copy that is safe to expose in the GUI.
 * @param failure - Failure value preserved by the session event.
 * @returns Display-safe copy for client projections.
 */
export function displayFailureMessage(failure: unknown): string {
  if (failure === null || typeof failure !== 'object') {
    return redactSecrets(String(failure))
  }
  const record = failure as { code?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : undefined
  // AUTH may echo a masked credential — never project provider copy.
  if (code === 'AUTH') return CODE_FALLBACK.AUTH

  const raw =
    typeof record.message === 'string' && record.message !== '[object Object]'
      ? record.message
      : undefined
  const detail = raw ? stripAdapterPrefix(raw) : ''

  if (detail) return redactSecrets(detail)

  if (code && CODE_FALLBACK[code]) return CODE_FALLBACK[code]

  if (raw) return redactSecrets(raw)
  try {
    return redactSecrets(JSON.stringify(failure))
  } catch {
    return 'turn failed'
  }
}
