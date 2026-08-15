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
      ollama: {
        protocol: "openai-chat",
        baseUrl: "http://127.0.0.1:11434/v1",
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
    expect(getOpenAiChatBrand("nope")).toBeUndefined();
  });
});
