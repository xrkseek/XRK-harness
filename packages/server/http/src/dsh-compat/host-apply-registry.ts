/**
 * Tracks community packages whose `host.mjs` apply() succeeded during dsh-compat compose.
 */
export interface HostApplyRecord {
  readonly packageName: string;
  readonly httpPrefixes: readonly string[];
  readonly rpcChannels: readonly string[];
}

const applied = new Map<string, HostApplyRecord>();

export function resetHostApplyRegistry(): void {
  applied.clear();
}

export function registerHostApply(record: HostApplyRecord): void {
  applied.set(record.packageName, record);
}

export function listHostAppliedPackages(): readonly HostApplyRecord[] {
  return [...applied.values()];
}

export function isHostApplied(packageName: string): boolean {
  return applied.has(packageName.trim());
}

export function getHostApplyRecord(
  packageName: string,
): HostApplyRecord | undefined {
  return applied.get(packageName.trim());
}
