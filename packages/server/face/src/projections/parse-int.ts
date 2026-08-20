/** Shared projection parse helpers (scoped error labels). */

export function asNonNegInt(
  value: unknown,
  scope: string,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${scope}.${label} must be a non-negative integer`);
  }
  return value;
}

export function asOptNonNegInt(
  value: unknown,
  scope: string,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  return asNonNegInt(value, scope, label);
}

export function asOptPositiveInt(
  value: unknown,
  scope: string,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${scope}.${label} must be a positive integer`);
  }
  return value;
}

export function asNonNegNumber(
  value: unknown,
  scope: string,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${scope}.${label} must be a non-negative number`);
  }
  return value;
}
