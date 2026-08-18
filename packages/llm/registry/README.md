# @xrkseek/llm-registry

Provider Registry R0: BrandEntries + `resolve` → `createAdapter` for `openai-chat`.

Not a bare constants table — call `createProviderRegistry()` then `resolve` / `createAdapter`.

Specs: [docs/llm-provider-registry.md](../../../docs/llm-provider-registry.md).

**Non-goals (R1+):** Anthropic / Gemini / Azure official protocol packages.
