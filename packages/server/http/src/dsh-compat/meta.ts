/** XRK community-host adapter id on DSH-shaped wire responses. */
export const DSH_COMPAT_ADAPTER = "xrk-dsh-compat";

/** Tag a JSON body with the compat adapter id. */
export function tag<T extends Record<string, unknown>>(
  body: T,
  incomplete?: readonly string[],
): T & { adapter: string; incomplete?: string[] } {
  return {
    ...body,
    adapter: DSH_COMPAT_ADAPTER,
    ...(incomplete?.length ? { incomplete: [...incomplete] } : {}),
  };
}

/** Honest offline stub for a Cordis Host feature. */
export function hostIncomplete(
  feature: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return tag({ ...extra }, [`${feature}-host`]);
}
