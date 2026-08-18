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
