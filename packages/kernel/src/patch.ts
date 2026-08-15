/**
 * Config composition: later layers replace entire entries by `id`.
 * No deep merge — nested objects are replaced wholesale.
 */

export interface PatchEntry<TConfig = unknown> {
  readonly id: string;
  readonly config: TConfig;
}

export type PatchLayer<TConfig = unknown> = readonly PatchEntry<TConfig>[];

export function applyPatches<TConfig = unknown>(
  base: PatchLayer<TConfig>,
  ...layers: PatchLayer<TConfig>[]
): PatchEntry<TConfig>[] {
  const map = new Map<string, PatchEntry<TConfig>>();
  for (const entry of base) {
    if (!entry.id) {
      throw new Error("patch entry id must be non-empty");
    }
    map.set(entry.id, entry);
  }
  for (const layer of layers) {
    for (const entry of layer) {
      if (!entry.id) {
        throw new Error("patch entry id must be non-empty");
      }
      map.set(entry.id, entry);
    }
  }
  return [...map.values()];
}

/** Convenience: find config by id after layering. */
export function getPatchedConfig<TConfig = unknown>(
  id: string,
  base: PatchLayer<TConfig>,
  ...layers: PatchLayer<TConfig>[]
): TConfig | undefined {
  return applyPatches(base, ...layers).find((e) => e.id === id)?.config;
}
