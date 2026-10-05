import { describe, expect, it } from "vitest";
import {
  formatPeerCollabPrompt,
  peerThreadMessageProblem,
} from "../src/session-thread-message.js";

describe("peerThreadMessageProblem", () => {
  it("rejects self, unbound sides, and subagent targets", () => {
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_a",
        selfBound: true,
        targetBound: true,
        targetIsChild: false,
      }),
    ).toContain("cannot message this session");
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_b",
        selfBound: false,
        targetBound: true,
        targetIsChild: false,
      }),
    ).toContain("no 主线");
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_child",
        selfBound: true,
        targetBound: true,
        targetIsChild: true,
      }),
    ).toContain("subagent");
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_b",
        selfBound: true,
        targetBound: false,
        targetIsChild: false,
      }),
    ).toContain("not a 主线 parent");
  });

  it("allows two 主线 parents", () => {
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_b",
        selfBound: true,
        targetBound: true,
        targetIsChild: false,
      }),
    ).toBeUndefined();
  });
});

describe("formatPeerCollabPrompt", () => {
  it("names the sender and asks the peer to answer in this turn", () => {
    const text = formatPeerCollabPrompt({
      fromSessionId: "sess_a",
      fromThreadTitle: "0.5.12 发版",
      message: "Need the changelog draft.",
    });
    expect(text).toContain("sess_a");
    expect(text).toContain("0.5.12 发版");
    expect(text).toContain("Need the changelog draft.");
    expect(text).toContain("Do not spawn a subagent");
  });
});
