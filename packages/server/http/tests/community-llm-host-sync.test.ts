import { describe, expect, it, vi } from "vitest";
import {
  asCommunityLlmModelRows,
  enrichCommunityModelsWithResolve,
  reasoningFromUnknown,
} from "../src/dsh-compat/community-llm-host-sync.js";

describe("community-llm-host-sync reasoning", () => {
  it("parses resolveModel-shaped reasoning blobs", () => {
    expect(
      reasoningFromUnknown({
        reasoning: {
          efforts: [
            { id: "light", name: "Light" },
            { id: "balanced", name: "Balanced" },
          ],
          defaultEffort: "balanced",
        },
      }),
    ).toEqual({
      efforts: [
        { id: "light", name: "Light" },
        { id: "balanced", name: "Balanced" },
      ],
      defaultEffort: "balanced",
    });
  });

  it("parses product-row reasoningEfforts string lists", () => {
    expect(
      reasoningFromUnknown({
        reasoningEfforts: ["low", "high", "max"],
        defaultReasoningEffort: "high",
      }),
    ).toEqual({
      efforts: [
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
        { id: "max", name: "Max" },
      ],
      defaultEffort: "high",
    });
  });

  it("parses DSH pi-ai reasoningEfforts dict (per-provider wire map)", () => {
    expect(
      reasoningFromUnknown({
        reasoningEfforts: {
          off: null,
          low: "low",
          high: "high",
          max: "ultra",
        },
        defaultReasoningEffort: "high",
      }),
    ).toEqual({
      efforts: [
        { id: "off", name: "Off" },
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
        { id: "max", name: "Max" },
      ],
      defaultEffort: "high",
    });
  });

  it("ignores reasoningEfforts: false (non-reasoning model)", () => {
    expect(reasoningFromUnknown({ reasoningEfforts: false })).toBeUndefined();
  });

  it("keeps reasoning already present on listModels rows", () => {
    const rows = asCommunityLlmModelRows([
      {
        id: "wb-1",
        name: "WB",
        contextWindow: 64_000,
        reasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium",
      },
    ]);
    expect(rows[0]?.reasoning).toEqual({
      efforts: [{ id: "medium", name: "Medium" }],
      defaultEffort: "medium",
    });
  });

  it("enriches bare listModels rows via resolveModel (DSH catalog parity)", async () => {
    const resolveModel = vi.fn(async (_provider: string, model: string) => ({
      id: model,
      reasoning: {
        efforts: [{ id: "deep", name: "Deep" }],
        defaultEffort: "deep",
      },
      context: { contextWindow: 200_000 },
      defaultMaxTokens: 16_000,
    }));
    const listed = asCommunityLlmModelRows([
      { id: "muse-spark", name: "Muse Spark" },
    ]);
    const enriched = await enrichCommunityModelsWithResolve(
      { resolveModel },
      "our-free-model",
      listed,
    );
    expect(resolveModel).toHaveBeenCalledWith("our-free-model", "muse-spark");
    expect(enriched[0]).toMatchObject({
      id: "muse-spark",
      contextWindow: 200_000,
      maxTokens: 16_000,
      reasoning: {
        efforts: [{ id: "deep", name: "Deep" }],
        defaultEffort: "deep",
      },
    });
  });
});
