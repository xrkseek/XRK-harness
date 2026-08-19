/**
 * Bounded reconnect policy for one MCP stdio generation (DSH connection.ts).
 * HTTP process-level restart is off by default — the SDK owns SSE resume.
 */

/** Automatic reconnect policy for one MCP client. */
export interface McpReconnectConfig {
  /** Reconnect after a lost generation (stdio default true; http default false). */
  readonly enabled?: boolean;
  /** First delay in ms; doubles per consecutive failed attempt (default 500). */
  readonly initialDelayMs?: number;
  /** Backoff ceiling and stability window in ms (default 30_000). */
  readonly maxDelayMs?: number;
  /** Consecutive failed attempts per outage before giving up (default 10). */
  readonly maxAttempts?: number;
}

/** Node `setTimeout` max delay. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Defaults shared by {@link resolveReconnectPolicy}. */
export const RECONNECT_DEFAULTS: Required<McpReconnectConfig> = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
});

/** Fully resolved reconnect policy captured at client construction. */
export type ResolvedReconnectPolicy = Readonly<Required<McpReconnectConfig>>;

/**
 * Resolve raw reconnect config. Misconfiguration fails at construct time.
 *
 * @param config - Raw `reconnect` config; omission uses the defaults.
 * @param path - Diagnostic prefix naming the config location in thrown messages.
 */
export function resolveReconnectPolicy(
  config: McpReconnectConfig | undefined,
  path: string,
): ResolvedReconnectPolicy {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) {
        throw new Error(`${path}.${key} is not a reconnect option`);
      }
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled;
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs;
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs;
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts;
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`${path}.maxAttempts must be a positive integer`);
  }
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts });
}
