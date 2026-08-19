import { describe, expect, it } from "vitest";
import { foldRequestHeader, requestHeaderEquals } from "../src/request-header.js";
import type { SessionEvent } from "@xrkseek/protocol";

describe("foldRequestHeader", () => {
  it("returns latest request/header snapshot", () => {
    const events: SessionEvent[] = [
      {
        type: "request/header",
        ts: 1,
        turnId: "t1",
        reason: "initial",
        header: {
          config: { provider: "deepseek", model: "deepseek-v4-flash" },
        },
      },
      {
        type: "request/header",
        ts: 2,
        turnId: "t2",
        reason: "change",
        header: {
          config: {
            provider: "deepseek",
            model: "deepseek-v4-pro",
            reasoningEffort: "high",
          },
        },
      },
    ];
    expect(foldRequestHeader(events)).toEqual({
      config: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        reasoningEffort: "high",
      },
    });
  });

  it("compares configs for dedupe", () => {
    expect(
      requestHeaderEquals(
        { config: { provider: "a", model: "m" } },
        { config: { provider: "a", model: "m" } },
      ),
    ).toBe(true);
    expect(
      requestHeaderEquals(
        { config: { provider: "a", model: "m" } },
        { config: { provider: "a", model: "m2" } },
      ),
    ).toBe(false);
  });
});
