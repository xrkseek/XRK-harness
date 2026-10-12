import { describe, expect, it } from "vitest";
import {
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
      softBudgetMaxTokens: 96_000,
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
      contextWindow: 200_000,
      maxTokens: 32_000,
      softBudgetMaxTokens: 50_000,
      inputModalities: ["text"],
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
    expect(defaultSoftBudgetMaxTokens(8_000)).toBe(8_000);
  });
});
