/**
 * Remap DSH client boot inject ids onto XRK product-shell packages.
 * Unknown `@deepseek-ai/*` entries are dropped (with optional warn) so boot
 * does not stall on missing ModuleLoader rows.
 */
export interface RemapInjectResult {
  readonly inject: readonly string[];
  readonly dropped: readonly string[];
}

const EXACT: Readonly<Record<string, string>> = {
  "@deepseek-ai/dsh-client-runtime": "@xrkseek/client-runtime",
  "@deepseek-ai/dsh-client-locale": "@xrkseek/client-locale",
  "@deepseek-ai/dsh-client-ui-slots": "@xrkseek/client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives": "@xrkseek/client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-conversation": "@xrkseek/client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-attachment": "@xrkseek/client-ui-attachment",
  "@deepseek-ai/dsh-client-web-react": "@xrkseek/client-web-react",
  "@deepseek-ai/dsh-client-schema-form": "@xrkseek/client-schema-form",
};

/**
 * Map one inject id. Returns `undefined` when the id should be dropped.
 */
export function remapInjectId(id: string): string | undefined {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@xrkseek/")) return trimmed;
  const exact = EXACT[trimmed];
  if (exact) return exact;
  // @deepseek-ai/dsh-client-ui-foo → @xrkseek/client-ui-foo
  const ui = /^@deepseek-ai\/dsh-client-(ui-.+)$/.exec(trimmed);
  if (ui?.[1]) return `@xrkseek/client-${ui[1]}`;
  const client = /^@deepseek-ai\/dsh-client-(.+)$/.exec(trimmed);
  if (client?.[1]) return `@xrkseek/client-${client[1]}`;
  if (trimmed.startsWith("@deepseek-ai/")) return undefined;
  return trimmed;
}

/** Remap a full inject list; preserve order, dedupe. */
export function remapInjectList(
  inject: readonly string[] | undefined,
): RemapInjectResult {
  const out: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of inject ?? []) {
    const mapped = remapInjectId(raw);
    if (mapped === undefined) {
      dropped.push(raw);
      continue;
    }
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return { inject: out, dropped };
}
