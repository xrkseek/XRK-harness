import { describe, expect, it } from "vitest";
import {
  delegateParentDepthFromLead,
  resolveDelegateParentLook,
} from "../src/client/delegate-parent-look.ts";

describe("delegateParentDepthFromLead", () => {
  it("lead is depth 0; ancestors grow toward root", () => {
    expect(delegateParentDepthFromLead(2, 3)).toBe(0);
    expect(delegateParentDepthFromLead(1, 3)).toBe(1);
    expect(delegateParentDepthFromLead(0, 3)).toBe(2);
  });
});

describe("resolveDelegateParentLook", () => {
  it("skips boss layers", () => {
    expect(
      resolveDelegateParentLook({
        parent: { sessionId: "s:boss", label: "老板" },
        isLead: false,
        isBossLayer: true,
        leadSnapshot: { shape: "wedge", color: "sage" },
      }),
    ).toBeUndefined();
  });

  it("lead prefers parentCompanionBall snapshot", () => {
    expect(
      resolveDelegateParentLook({
        parent: {
          sessionId: "mid",
          look: { shape: "blob", color: "cream" },
        },
        isLead: true,
        isBossLayer: false,
        leadSnapshot: { shape: "wedge", color: "sage", kit: "bow" },
      }),
    ).toEqual({ shape: "wedge", color: "sage", kit: "bow" });
  });

  it("ancestors use Face parents[].look (relationship chain)", () => {
    expect(
      resolveDelegateParentLook({
        parent: {
          sessionId: "root",
          look: { shape: "pill", color: "rose" },
        },
        isLead: false,
        isBossLayer: false,
      }),
    ).toEqual({ shape: "pill", color: "rose" });
  });
});
