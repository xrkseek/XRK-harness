/**
 * Resolve live LLM adapter from Face settings + credentials (DSH parity).
 */
import type { LlmAdapter } from "@xrkseek/llm";
import {
  createRoutingLlmAdapter,
  type RoutingLlmAdapter,
} from "@xrkseek/llm-registry";
import type { ProviderBinding } from "@xrkseek/llm-registry";
import type { FaceRuntime } from "./context.js";
import {
  resolveSessionModelSelection,
  type FaceModelSelection,
} from "./model-catalog.js";
import {
  providerHasUsableCredential,
  readProviderApiKey,
  readProviderRoute,
  resolveProviderBinding,
} from "./llm-provider-context.js";

export interface ResolvedFaceLlm {
  readonly binding: ProviderBinding;
  readonly adapter: LlmAdapter;
  readonly selection: FaceModelSelection;
}

export class FaceLlmResolveError extends Error {
  readonly code: "missing-credential" | "resolve-failed";

  constructor(code: FaceLlmResolveError["code"], message: string) {
    super(message);
    this.name = "FaceLlmResolveError";
    this.code = code;
  }
}

/** Build adapter for an explicit selection (selectModel preflight + agent factory). */
export function resolveLlmForSelection(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): ResolvedFaceLlm {
  if (!providerHasUsableCredential(runtime, selection.provider)) {
    const brand = runtime.registry.listBrands().find(
      (b) => b.id === selection.provider,
    );
    const ref = brand?.apiKeyEnv ?? `llm.${selection.provider}`;
    throw new FaceLlmResolveError(
      "missing-credential",
      `no API key configured for provider "${selection.provider}" (${ref})`,
    );
  }

  const route = readProviderRoute(runtime, selection.provider);
  const { apiKey } = readProviderApiKey(runtime, selection.provider);
  const binding = resolveProviderBinding(runtime.registry, {
    provider: selection.provider,
    model: selection.model,
    route,
  });
  const adapter = runtime.registry.createAdapter(
    binding,
    apiKey ? { apiKey } : {},
    {
      id: `${binding.provider}:${binding.model}`,
      model: selection.model,
      ...(runtime.inputModalities !== undefined
        ? { inputModalities: runtime.inputModalities }
        : {}),
    },
  );
  return { binding, adapter, selection };
}

/** Session-scoped routing adapter (DSH hot model switch without agent invalidate). */
export function createSessionRoutingLlm(
  runtime: FaceRuntime,
  sessionId: string,
): RoutingLlmAdapter | undefined {
  const pickSelection = (): FaceModelSelection =>
    runtime.sessionModels.get(sessionId) ??
    resolveSessionModelSelection(runtime, sessionId);
  try {
    resolveLlmForSelection(runtime, pickSelection());
  } catch {
    return undefined;
  }
  return createRoutingLlmAdapter({
    id: `session:${sessionId}`,
    getSelection: pickSelection,
    resolveAdapter: (selection) =>
      resolveLlmForSelection(runtime, selection).adapter,
    ...(runtime.inputModalities !== undefined
      ? { inputModalities: runtime.inputModalities }
      : {}),
  });
}

/** Build adapter for the session's selected provider/model when credentials exist. */
export function resolveLlmForSession(
  runtime: FaceRuntime,
  sessionId: string,
): ResolvedFaceLlm | undefined {
  const routing = createSessionRoutingLlm(runtime, sessionId);
  if (!routing) return undefined;
  const selection = resolveSessionModelSelection(runtime, sessionId);
  const config = routing.ensureRoute();
  return {
    binding: resolveProviderBinding(runtime.registry, {
      provider: config.provider,
      model: config.model,
      route: readProviderRoute(runtime, config.provider),
    }),
    adapter: routing,
    selection,
  };
}
