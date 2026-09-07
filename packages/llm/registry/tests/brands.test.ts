import { describe, expect, it } from "vitest";
import {
  OPENAI_CHAT_BRANDS,
  getOpenAiChatBrand,
} from "../src/index.js";

describe("OPENAI_CHAT_BRANDS", () => {
  it("locks baseUrl/authMode/path/apiKeyEnv/protocol per id", () => {
    const snap = Object.fromEntries(
      OPENAI_CHAT_BRANDS.map((b) => [
        b.id,
        {
          protocol: b.protocol,
          baseUrl: b.baseUrl ?? null,
          path: b.path ?? "/chat/completions",
          authMode: b.authMode ?? "bearer",
          apiKeyEnv: b.apiKeyEnv ?? null,
        },
      ]),
    );
    expect(snap).toEqual({
      openai: {
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      deepseek: {
        protocol: "openai-chat",
        baseUrl: "https://api.deepseek.com",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "DEEPSEEK_API_KEY",
      },
      opencode: {
        protocol: "openai-chat",
        baseUrl: "https://opencode.ai/zen/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "OPENCODE_API_KEY",
      },
      "opencode-go": {
        protocol: "openai-chat",
        baseUrl: "https://opencode.ai/zen/go/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "OPENCODE_GO_API_KEY",
      },
      openrouter: {
        protocol: "openai-chat",
        baseUrl: "https://openrouter.ai/api/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
      groq: {
        protocol: "openai-chat",
        baseUrl: "https://api.groq.com/openai/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "GROQ_API_KEY",
      },
      fireworks: {
        protocol: "openai-chat",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "FIREWORKS_API_KEY",
      },
      together: {
        protocol: "openai-chat",
        baseUrl: "https://api.together.xyz/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "TOGETHER_API_KEY",
      },
      "github-models": {
        protocol: "openai-chat",
        baseUrl: "https://models.inference.ai.azure.com",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "GITHUB_TOKEN",
      },
      xai: {
        protocol: "openai-chat",
        baseUrl: "https://api.x.ai/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "XAI_API_KEY",
      },
      mistral: {
        protocol: "openai-chat",
        baseUrl: "https://api.mistral.ai/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "MISTRAL_API_KEY",
      },
      cerebras: {
        protocol: "openai-chat",
        baseUrl: "https://api.cerebras.ai/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "CEREBRAS_API_KEY",
      },
      deepinfra: {
        protocol: "openai-chat",
        baseUrl: "https://api.deepinfra.com/v1/openai",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "DEEPINFRA_API_KEY",
      },
      "novita-ai": {
        protocol: "openai-chat",
        baseUrl: "https://api.novita.ai/openai",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "NOVITA_API_KEY",
      },
      siliconflow: {
        protocol: "openai-chat",
        baseUrl: "https://api.siliconflow.com/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "SILICONFLOW_API_KEY",
      },
      "siliconflow-cn": {
        protocol: "openai-chat",
        baseUrl: "https://api.siliconflow.cn/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "SILICONFLOW_CN_API_KEY",
      },
      moonshotai: {
        protocol: "openai-chat",
        baseUrl: "https://api.moonshot.ai/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "MOONSHOT_API_KEY",
      },
      "moonshotai-cn": {
        protocol: "openai-chat",
        baseUrl: "https://api.moonshot.cn/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "MOONSHOT_API_KEY",
      },
      minimax: {
        protocol: "openai-chat",
        baseUrl: "https://api.minimax.io/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "MINIMAX_API_KEY",
      },
      "minimax-cn": {
        protocol: "openai-chat",
        baseUrl: "https://api.minimaxi.com/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "MINIMAX_API_KEY",
      },
      zai: {
        protocol: "openai-chat",
        baseUrl: "https://api.z.ai/api/paas/v4",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "ZHIPU_API_KEY",
      },
      zhipuai: {
        protocol: "openai-chat",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "ZHIPU_API_KEY",
      },
      perplexity: {
        protocol: "openai-chat",
        baseUrl: "https://api.perplexity.ai",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "PERPLEXITY_API_KEY",
      },
      huggingface: {
        protocol: "openai-chat",
        baseUrl: "https://router.huggingface.co/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "HF_TOKEN",
      },
      nvidia: {
        protocol: "openai-chat",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "NVIDIA_API_KEY",
      },
      baseten: {
        protocol: "openai-chat",
        baseUrl: "https://inference.baseten.co/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "BASETEN_API_KEY",
      },
      vercel: {
        protocol: "openai-chat",
        baseUrl: "https://ai-gateway.vercel.sh/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "AI_GATEWAY_API_KEY",
      },
      aihubmix: {
        protocol: "openai-chat",
        baseUrl: "https://aihubmix.com/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "AIHUBMIX_API_KEY",
      },
      ollama: {
        protocol: "openai-chat",
        baseUrl: "http://127.0.0.1:11434/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: null,
      },
      lmstudio: {
        protocol: "openai-chat",
        baseUrl: "http://127.0.0.1:1234/v1",
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: null,
      },
      "azure-openai": {
        protocol: "openai-chat",
        baseUrl: null,
        path: "/chat/completions",
        authMode: "api-key",
        apiKeyEnv: "AZURE_OPENAI_API_KEY",
      },
      newapi: {
        protocol: "openai-chat",
        baseUrl: null,
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "NEWAPI_API_KEY",
      },
      cherryin: {
        protocol: "openai-chat",
        baseUrl: null,
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "CHERRYIN_API_KEY",
      },
      custom: {
        protocol: "openai-chat",
        baseUrl: null,
        path: "/chat/completions",
        authMode: "bearer",
        apiKeyEnv: "OPENAI_API_KEY",
      },
    });
  });

  it("getOpenAiChatBrand is case-insensitive", () => {
    expect(getOpenAiChatBrand("OpenRouter")?.id).toBe("openrouter");
    expect(getOpenAiChatBrand("minimax-cn")?.baseUrl).toBe(
      "https://api.minimaxi.com/v1",
    );
    expect(getOpenAiChatBrand("nope")).toBeUndefined();
  });
});
