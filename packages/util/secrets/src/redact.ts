/**
 * Best-effort secret redaction for logs and durable text (Codex-style sanitizer).
 * Not a wire `role('secret')` walker — see `@xrkseek/xrk-settings` for that.
 */

const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const AWS_ACCESS = /\bAKIA[0-9A-Z]{16}\b/g;
const BEARER = /\bBearer[ \t]+[A-Za-z0-9._~+/-]{16,}=*/gi;
const ASSIGNMENT =
  /\b(api[_-]?key|token|secret|password)\b(\s*[:=]\s*)(["']?)[^\s"']{8,}/gi;

/** Placeholder used in redacted output. */
export const REDACTED_SECRET = "[REDACTED_SECRET]";

/**
 * Remove well-known secret shapes from a string (best-effort).
 * Safe to call on every log line; does not throw.
 */
export function redactSecrets(input: string): string {
  let out = input;
  out = out.replace(BEARER, `Bearer ${REDACTED_SECRET}`);
  out = out.replace(OPENAI_KEY, REDACTED_SECRET);
  out = out.replace(AWS_ACCESS, REDACTED_SECRET);
  out = out.replace(ASSIGNMENT, `$1$2$3${REDACTED_SECRET}`);
  return out;
}

/** Minimal logger surface shared by CLI / Host sinks. */
export interface RedactingLogger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

/**
 * Wrap a logger so every message is passed through {@link redactSecrets}.
 */
export function wrapLoggerForSecrets<T extends RedactingLogger>(inner: T): T {
  const wrap = (fn: (msg: string) => void) => (msg: string) => {
    fn(redactSecrets(msg));
  };
  return {
    ...inner,
    error: wrap(inner.error.bind(inner)),
    warn: wrap(inner.warn.bind(inner)),
    info: wrap(inner.info.bind(inner)),
    debug: wrap(inner.debug.bind(inner)),
  };
}
