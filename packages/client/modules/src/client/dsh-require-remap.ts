/**
 * Map community DSH client require / inject ids onto XRK shell module ids.
 * Used by {@link ClientModuleSystem} so `require("@deepseek-ai/dsh-client-*")`
 * hits the same seed / graph rows as `@xrkseek/client-*` (plugin `apply`
 * aliases are too late — factories require during materialization).
 */

const EXACT: Readonly<Record<string, string>> = {
  "@deepseek-ai/dsh-client-runtime": "@xrkseek/client-runtime",
  "@deepseek-ai/dsh-client-locale": "@xrkseek/client-locale",
  "@deepseek-ai/dsh-client-ui-slots": "@xrkseek/client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives": "@xrkseek/client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-conversation": "@xrkseek/client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-attachment": "@xrkseek/client-ui-attachment",
  "@deepseek-ai/dsh-client-ui-reference": "@xrkseek/client-ui-reference",
  "@deepseek-ai/dsh-client-web-react": "@xrkseek/client-web-react",
  "@deepseek-ai/dsh-client-schema-form": "@xrkseek/client-schema-form",
  "@deepseek-ai/dsh-client-modules": "@xrkseek/client-modules",
  "@deepseek-ai/dsh-api-remotes": "@xrkseek/xrk-api-remotes",
  "@deepseek-ai/dsh-api-gateway": "@xrkseek/xrk-api-gateway",
};

/**
 * @param spec - raw `require()` / import specifier from a community bundle.
 * @returns XRK module id, or `undefined` when this is not a remappable DSH client id.
 */
export function remapDshClientRequire(spec: string): string | undefined {
  let id = spec.trim();
  if (!id) return undefined;
  if (id.endsWith("/client")) id = id.slice(0, -"/client".length);
  if (id.startsWith("@xrkseek/")) return id;
  const exact = EXACT[id];
  if (exact) return exact;
  const ui = /^@deepseek-ai\/dsh-client-(ui-.+)$/.exec(id);
  if (ui?.[1]) return `@xrkseek/client-${ui[1]}`;
  const client = /^@deepseek-ai\/dsh-client-(.+)$/.exec(id);
  if (client?.[1]) return `@xrkseek/client-${client[1]}`;
  return undefined;
}
