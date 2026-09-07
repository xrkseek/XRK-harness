/**
 * Assistant wire `message.source` attribution (Face mux / history).
 * Prefer the live `request/header` route; fall back to session model selection.
 */

export interface FaceModelRoute {
  readonly provider: string;
  readonly model: string;
}

/** Wire source when no route is known yet (unit tests / cold sessions). */
export const FACE_ASSISTANT_SOURCE_PLACEHOLDER = {
  kind: "model",
  provider: "xrk",
  model: "unknown",
} as const;

/** Cost-ledger key when usage arrives before any request/header. */
export const FACE_USAGE_ROUTE_PLACEHOLDER: FaceModelRoute = {
  provider: "unknown",
  model: "unknown",
};

/**
 * Normalize an optional route into Face assistant `message.source`.
 * Empty strings fall back to the placeholder so token-meter never sees blanks.
 */
export function assistantMessageSource(
  route?: FaceModelRoute | null,
): {
  readonly kind: "model";
  readonly provider: string;
  readonly model: string;
} {
  const provider = route?.provider?.trim();
  const model = route?.model?.trim();
  if (!provider || !model) return { ...FACE_ASSISTANT_SOURCE_PLACEHOLDER };
  return { kind: "model", provider, model };
}

/** `provider:model` map key for costUsage / cost-meter buckets. */
export function providerModelKey(route: FaceModelRoute): string {
  return `${route.provider}:${route.model}`;
}

export function routeFromRequestHeader(event: {
  readonly type: string;
  readonly header?: { readonly config?: { readonly provider?: string; readonly model?: string } };
}): FaceModelRoute | undefined {
  if (event.type !== "request/header") return undefined;
  const provider = event.header?.config?.provider?.trim();
  const model = event.header?.config?.model?.trim();
  if (!provider || !model) return undefined;
  return { provider, model };
}
