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
  lookupModelContextWindow,
  resolveAgentDefaultModel,
  resolveSessionModelSelection,
  type FaceModelSelection,
} from "./model-catalog.js";
import {
  providerHasUsableCredential,
  providerApiKeyEnv,
  readProviderApiKey,
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
    const ref = brand?.apiKeyEnv ?? providerApiKeyEnv(runtime, selection.provider) ?? `llm.${selection.provider}`;
    throw new FaceLlmResolveError(
      "missing-credential",
      `no API key configured for provider "${selection.provider}" (${ref})`,
    );
  }

  const { apiKey } = readProviderApiKey(runtime, selection.provider);
  const binding = resolveProviderBinding(runtime, {
    provider: selection.provider,
    model: selection.model,
  });
  const adapter = runtime.registry.createAdapter(
    binding,
    apiKey ? { apiKey } : {},
    {
      id: `${binding.provider}:${binding.model}`,
      model: selection.model,
      ...(runtime.attachments?.readImageRequest
        ? {
            readImageRequest: (
              ref,
              policy,
              signal,
            ) => runtime.attachments!.readImageRequest!(ref, policy, signal),
          }
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
    getSelection: () => {
      const selection = pickSelection();
      const contextWindow = lookupModelContextWindow(runtime, selection);
      return {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort !== undefined
          ? { reasoningEffort: selection.reasoningEffort }
          : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
      };
    },
    resolveAdapter: (selection) =>
      resolveLlmForSelection(runtime, selection).adapter,
  });
}

/**
 * Whether the live model route declares image input (DSH resolveModelInfo gate).
 * Face `inputModalities` is intake-only and must not override this.
 */
export function liveRouteAllowsImageInput(
  runtime: FaceRuntime,
  sessionId?: string,
): boolean {
  try {
    const selection =
      sessionId !== undefined
        ? resolveSessionModelSelection(runtime, sessionId)
        : resolveAgentDefaultModel(runtime) ??
          resolveSessionModelSelection(runtime, "");
    const { adapter } = resolveLlmForSelection(runtime, selection);
    return (adapter.inputModalities ?? ["text"]).includes("image");
  } catch {
    return false;
  }
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
    binding: resolveProviderBinding(runtime, {
      provider: config.provider,
      model: config.model,
    }),
    adapter: routing,
    selection,
  };
}
