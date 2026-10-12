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
