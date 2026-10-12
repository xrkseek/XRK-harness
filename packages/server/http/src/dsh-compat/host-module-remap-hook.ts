/**
 * Node customize-hook: remap DSH community host import ids onto XRK packages.
 * Registered once before loading Cordis LLM host halves (e.g. WorkBuddy).
 *
 * Keep this file self-contained (no local imports): `module.register` loads it
 * as the hook entry; sibling `.ts`/`.js` imports are unreliable across src/dist.
 *
 * Resolve remapped ids from this module's package (server-http), not from the
 * staged plugin directory under pluginsDir.
 */

/** One-off targets that are not `@xrkseek/xrk-<suffix>`. */
const EXACT: Record<string, string> = {
  "@deepseek-ai/cordis": "@xrkseek/cordis",
  "@deepseek-ai/schemastery": "@xrkseek/schemastery",
  "@deepseek-ai/dsh-home-paths": "@xrkseek/xrk-home-paths",
  "@deepseek-ai/dsh-atomic-write": "@xrkseek/xrk-atomic-write",
  "@deepseek-ai/dsh-llm": "@xrkseek/xrk-llm",
  "@deepseek-ai/dsh-llm-pi-ai": "@xrkseek/xrk-llm-pi-ai",
  "@deepseek-ai/dsh-agent-loop": "@xrkseek/core-agent-loop",
  "@deepseek-ai/dsh-attachment-local": "@xrkseek/attachment-local",
  "@deepseek-ai/dsh-credentials": "@xrkseek/secrets",
  "@deepseek-ai/dsh-workspace": "@xrkseek/workspace",
  "@earendil-works/pi-ai": "@xrkseek/xrk-pi-ai",
};

const DSH_PREFIX = "@deepseek-ai/dsh-";
const CLIENT_PREFIX = "@deepseek-ai/dsh-client-";
const PI_AI_PREFIX = "@earendil-works/pi-ai/";

/**
 * Map a community Host import specifier onto an XRK package id.
 * Returns `undefined` when the specifier should resolve unchanged.
 */
export function remapHostModuleId(specifier: string): string | undefined {
  const id = specifier.trim();
  if (!id) return undefined;

  const exact = EXACT[id];
  if (exact) return exact;

  if (id.startsWith(PI_AI_PREFIX)) {
    return `@xrkseek/xrk-pi-ai/${id.slice(PI_AI_PREFIX.length)}`;
  }

  // Browser client packages stay on the client ModuleLoader remap path.
  if (id.startsWith(CLIENT_PREFIX)) return undefined;

  // Convention: @deepseek-ai/dsh-FOO[/sub] → @xrkseek/xrk-FOO[/sub]
  if (id.startsWith(DSH_PREFIX)) {
    return `@xrkseek/xrk-${id.slice(DSH_PREFIX.length)}`;
  }

  return undefined;
}

type ResolveContext = {
  readonly parentURL?: string;
  readonly conditions?: string[];
  readonly importAttributes?: Record<string, string>;
};

type ResolveResult = {
  readonly url: string;
  readonly shortCircuit?: boolean;
  readonly format?: string | null;
};

/**
 * `@xrkseek/xrk-pi-ai` re-exports the real `@earendil-works/pi-ai` package.
 * Skip remapping those imports or the shim loops onto itself.
 */
function skipPiAiShimReexport(
  specifier: string,
  parentURL: string | undefined,
): boolean {
  if (!parentURL) return false;
  if (
    specifier !== "@earendil-works/pi-ai" &&
    !specifier.startsWith(PI_AI_PREFIX)
  ) {
    return false;
  }
  return parentURL.includes("xrk-pi-ai");
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: (
    specifier: string,
    context?: ResolveContext,
  ) => Promise<ResolveResult>,
): Promise<ResolveResult> {
  if (skipPiAiShimReexport(specifier, context.parentURL)) {
    return nextResolve(specifier, context);
  }
  const mapped = remapHostModuleId(specifier);
  if (mapped !== undefined) {
    return nextResolve(mapped, { ...context, parentURL: import.meta.url });
  }
  return nextResolve(specifier, context);
}
