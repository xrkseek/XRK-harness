import {
  assertLosslessJson,
  assertSessionEvent,
  type SessionEvent,
} from "@xrkseek/protocol";

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }
  return value;
}

export function newSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate, detach lossless JSON, and freeze one session event for the log.
 * Fail at append/seed — never wait for flush to discover Map/Date/BigInt.
 */
export function freezeSessionEvent(event: SessionEvent): SessionEvent {
  const parsed = assertSessionEvent(event);
  return deepFreeze(assertLosslessJson(parsed, "session event"));
}
