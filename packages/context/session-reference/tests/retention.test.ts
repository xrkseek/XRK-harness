import { describe, expect, it } from "vitest";
import {
  retainProjectedConversation,
  type ProjectedConversationItem,
} from "../src/retention.js";
import { stringifyTagSafeJson } from "../src/serialization.js";

describe("retainProjectedConversation", () => {
  it("drops older non-checkpoint rows before truncating the longest message", () => {
    const projected: ProjectedConversationItem[] = [
      {
        role: "user",
        text: "old",
        checkpoint: false,
        originalText: "old",
        omittedBytes: 0,
      },
      {
        role: "user",
        text: "<compacted-summary>checkpoint</compacted-summary>",
        checkpoint: true,
        originalText: "<compacted-summary>checkpoint</compacted-summary>",
        omittedBytes: 0,
      },
      {
        role: "user",
        text: `latest-${"界".repeat(40)}`,
        checkpoint: false,
        originalText: `latest-${"界".repeat(40)}`,
        omittedBytes: 0,
      },
    ];

    const retained = retainProjectedConversation(
      {
        sessionId: "source",
        label: "source",
        cwd: "/ws",
        capturedThroughSeq: 3,
      },
      projected,
      320,
    );

    expect(retained).toBeDefined();
    if (!retained) throw new Error("expected retained snapshot");
    expect(
      Buffer.byteLength(stringifyTagSafeJson(retained.data), "utf8"),
    ).toBeLessThanOrEqual(320);
    expect(retained.data.conversation.some((row) => row.text.includes("checkpoint"))).toBe(
      true,
    );
    expect(retained.data.conversation.some((row) => row.text.includes("latest-"))).toBe(
      true,
    );
    expect(retained.stats.truncated).toBe(true);
    expect(retained.stats.compacted).toBe(true);
  });

  it("returns undefined when fixed envelope fields cannot fit", () => {
    const projected: ProjectedConversationItem[] = [];
    expect(
      retainProjectedConversation(
        {
          sessionId: "source",
          label: "source",
          cwd: null,
          capturedThroughSeq: null,
        },
        projected,
        16,
      ),
    ).toBeUndefined();
  });
});
