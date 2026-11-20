/**
 * Example `kind: llm` — registers a sample ProviderRegistry brand.
 * Explicit Host brands win on id clash (`wireCompositionLlm`).
 * The endpoint is intentionally invalid — this is a shape sample only.
 * @see docs/plugin-loader.md · docs/llm-provider-registry.md
 */
export function createPlugin() {
  return {
    id: "example-llm",
    kind: "llm",
    llmBrands: [
      {
        id: "example-llm-sample",
        displayName: "Example LLM (sample)",
        protocol: "openai-chat",
        baseUrl: "https://example.invalid/v1",
        defaultModel: "example-model",
        apiKeyEnv: "XRK_EXAMPLE_LLM_KEY",
        notes: "Gold sample brand only — not a real endpoint.",
      },
    ],
  };
}
