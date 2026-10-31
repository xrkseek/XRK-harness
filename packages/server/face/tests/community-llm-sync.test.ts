import { describe, expect, it } from "vitest";
import {
  communityLoopbackBaseUrlCollision,
  defaultSoftBudgetMaxTokens,
  existingPiAiProvider,
  mergeCommunityProviderModels,
} from "../src/community-llm-sync.js";

describe("mergeCommunityProviderModels", () => {
  it("fills a default soft budget from contextWindow", () => {
    const merged = mergeCommunityProviderModels(
      [{ id: "wb-flash", name: "Flash", contextWindow: 128_000 }],
      undefined,
    );
    expect(merged[0]).toMatchObject({
      id: "wb-flash",
      name: "Flash",
      contextWindow: 128_000,
      softBudgetMaxTokens: 115_200,
    });
  });

  it("keeps user-edited capacities across catalog re-sync", () => {
    const merged = mergeCommunityProviderModels(
      [
        {
          id: "wb-flash",
          name: "Flash v2",
          contextWindow: 200_000,
          inputModalities: ["text"],
        },
      ],
      [
        {
          id: "wb-flash",
          name: "Flash",
          contextWindow: 128_000,
          maxTokens: 32_000,
          softBudgetMaxTokens: 50_000,
          inputModalities: ["text", "image"],
        },
      ],
    );
    expect(merged[0]).toEqual({
      id: "wb-flash",
      name: "Flash v2",
      // Tighter of incoming 200k vs previous 128k — never inflate the window.
      contextWindow: 128_000,
      maxTokens: 32_000,
      softBudgetMaxTokens: 50_000,
      inputModalities: ["text"],
    });
  });

  it("prefers the tighter contextWindow when catalog overstates (256k vs 1M)", () => {
    const merged = mergeCommunityProviderModels(
      [{ id: "proxy-chat", contextWindow: 1_000_000 }],
      [{ id: "proxy-chat", contextWindow: 256_000, softBudgetMaxTokens: 192_000 }],
    );
    expect(merged[0]).toMatchObject({
      id: "proxy-chat",
      contextWindow: 256_000,
      softBudgetMaxTokens: 192_000,
    });
  });

  it("carries reasoning menus from catalog sync into llm-pi-ai rows", () => {
    const merged = mergeCommunityProviderModels(
      [
        {
          id: "muse-spark",
          name: "Muse Spark",
          contextWindow: 128_000,
          reasoning: {
            efforts: [
              { id: "light", name: "Light" },
              { id: "balanced", name: "Balanced" },
            ],
            defaultEffort: "balanced",
          },
        },
      ],
      undefined,
    );
    expect(merged[0]?.reasoning).toEqual({
      efforts: [
        { id: "light", name: "Light" },
        { id: "balanced", name: "Balanced" },
      ],
      defaultEffort: "balanced",
    });
  });

  it("keeps previous reasoning when a re-sync omits the menu", () => {
    const merged = mergeCommunityProviderModels(
      [{ id: "muse-spark", name: "Muse Spark", contextWindow: 128_000 }],
      [
        {
          id: "muse-spark",
          reasoning: {
            efforts: [{ id: "deep", name: "Deep" }],
            defaultEffort: "deep",
          },
        },
      ],
    );
    expect(merged[0]?.reasoning).toEqual({
      efforts: [{ id: "deep", name: "Deep" }],
      defaultEffort: "deep",
    });
  });

  it("reads the existing provider row from llm-pi-ai settings", () => {
    const row = existingPiAiProvider(
      {
        providers: {
          "workbuddy-ai": {
            displayName: "WB",
            models: [{ id: "a", softBudgetMaxTokens: 12_000 }],
          },
        },
      },
      "workbuddy-ai",
    );
    expect(row?.displayName).toBe("WB");
    expect((row?.models as { id: string }[])[0]?.id).toBe("a");
  });

  it("omits a default when context is below the 8k floor", () => {
    expect(defaultSoftBudgetMaxTokens(4_000)).toBeUndefined();
    expect(defaultSoftBudgetMaxTokens(8_000)).toBe(7_200);
  });

  it("derives Codex 90% of the context window (no 300k soft cap)", () => {
    expect(defaultSoftBudgetMaxTokens(65_536)).toBe(58_982);
    expect(defaultSoftBudgetMaxTokens(128_000)).toBe(115_200);
    expect(defaultSoftBudgetMaxTokens(200_000)).toBe(180_000);
    expect(defaultSoftBudgetMaxTokens(1_000_000)).toBe(900_000);
    // 256Ki window → 235929 — must stay legal under Models schema (not step 1000).
    expect(defaultSoftBudgetMaxTokens(262_144)).toBe(235_929);
  });

  it("detects community loopback baseURL collisions (WB vs OFM)", () => {
    const llm = {
      providers: {
        "our-free-model": {
          baseURL: "http://127.0.0.1:58969/v1",
        },
        workbuddy: {
          baseURL: "http://127.0.0.1:63949/v1",
        },
      },
    };
    expect(
      communityLoopbackBaseUrlCollision(
        "workbuddy",
        "http://127.0.0.1:58969/v1",
        llm,
      ),
    ).toBe("our-free-model");
    expect(
      communityLoopbackBaseUrlCollision(
        "workbuddy",
        "http://127.0.0.1:63949/v1/",
        llm,
      ),
    ).toBeUndefined();
    expect(
      communityLoopbackBaseUrlCollision(
        "custom-openai",
        "http://127.0.0.1:58969/v1",
        llm,
      ),
    ).toBeUndefined();
  });
});
