/**
 * PiAiAdapter for community WorkBuddy host remaps (DSH `dsh-llm-pi-ai`).
 * Product chat still goes Face `llm-pi-ai` → WorkBuddy loopback shim.
 */

export class PiAiAdapter {
  constructor(options) {
    this.options = options;
  }

  profiles() {
    const p = this.options.profiles;
    return typeof p === "function" ? p() : p;
  }

  async listModels(provider) {
    const profile = this.profiles().get(provider);
    return profile?.piProvider?.getModels?.() ?? [];
  }

  async resolveModel(provider, model, _signal) {
    const listed = await this.listModels(provider);
    const hit = listed.find((row) => row.id === model);
    return hit ?? { provider, id: model, name: model };
  }

  async resolveApiKey() {
    return this.options.resolveApiKey?.();
  }
}

export default PiAiAdapter;
