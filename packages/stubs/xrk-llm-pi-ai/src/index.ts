/**
 * PiAiAdapter for community WorkBuddy host remaps (DSH `dsh-llm-pi-ai`).
 * Product chat still goes Face `llm-pi-ai` → WorkBuddy loopback shim; this
 * class is what WorkBuddy subclasses for catalog list/resolve at apply time.
 */

export interface PiAiAdapterOptions {
  readonly profiles:
    | Map<string, { readonly piProvider?: { getModels?: () => readonly unknown[] } }>
    | (() => Map<
        string,
        { readonly piProvider?: { getModels?: () => readonly unknown[] } }
      >);
  readonly auth?: unknown;
  readonly resolveApiKey?: () => Promise<string | undefined>;
  readonly resolveAttachments?: (...args: readonly unknown[]) => unknown;
  readonly resolveImageAccess?: (...args: readonly unknown[]) => unknown;
}

export class PiAiAdapter {
  protected readonly options: PiAiAdapterOptions;

  constructor(options: PiAiAdapterOptions) {
    this.options = options;
  }

  protected profiles(): Map<
    string,
    { readonly piProvider?: { getModels?: () => readonly unknown[] } }
  > {
    const p = this.options.profiles;
    return typeof p === "function" ? p() : p;
  }

  async listModels(provider: string): Promise<readonly Record<string, unknown>[]> {
    const profile = this.profiles().get(provider);
    const models = profile?.piProvider?.getModels?.() ?? [];
    return models as readonly Record<string, unknown>[];
  }

  async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const listed = await this.listModels(provider);
    const hit = listed.find((row) => row.id === model);
    return hit ?? { provider, id: model, name: model };
  }

  async resolveApiKey(): Promise<string | undefined> {
    return this.options.resolveApiKey?.();
  }
}

export default PiAiAdapter;
