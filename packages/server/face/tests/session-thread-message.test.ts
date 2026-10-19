import { describe, expect, it } from "vitest";
import {
  formatPeerCollabPrompt,
  peerThreadMessageProblem,
  sameDelegatedParent,
  teamPeerLinked,
} from "../src/session-thread-message.js";

describe("peerThreadMessageProblem", () => {
  it("rejects self, missing, and subagent targets — not unbound 主线", () => {
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_a",
        targetExists: true,
        targetIsChild: false,
      }),
    ).toContain("cannot message this session");
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_missing",
        targetExists: false,
        targetIsChild: false,
      }),
    ).toContain("unknown session_id");
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_child",
        targetExists: true,
        targetIsChild: true,
      }),
    ).toContain("subagent");
  });

  it("allows sibling children when siblingOk", () => {
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_b",
        targetExists: true,
        targetIsChild: false,
        siblingOk: true,
      }),
    ).toBeUndefined();
    expect(sameDelegatedParent("parent", "parent")).toBe(true);
    expect(sameDelegatedParent("parent", "other")).toBe(false);
    expect(
      teamPeerLinked(
        [{ kind: "peer", from: "a", to: "b" }],
        "b",
        "a",
      ),
    ).toBe(true);
  });

  it("allows any existing parent peer without 主线", () => {
    expect(
      peerThreadMessageProblem({
        selfId: "sess_a",
        targetId: "sess_b",
        targetExists: true,
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
    expect(text).toContain("会话协作");
    expect(text).toContain("Do not spawn a subagent");
  });
});
