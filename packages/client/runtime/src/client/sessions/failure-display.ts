// Pure string scrubber only: the package ROOT wires the OS keyring store and
// must never reach a browser bundle (see the `xrk-client-bundle-purity` gate).
import { redactSecrets } from '@xrkseek/secrets/redact'

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
  // Provider AUTH messages may echo a masked or partially preserved credential.
  // Keep the raw diagnostic in the session log, but never project it into UI state.
  if (record.code === 'AUTH') return 'API key is invalid'
  if (typeof record.message === 'string') return redactSecrets(record.message)
  return redactSecrets(JSON.stringify(failure))
}
