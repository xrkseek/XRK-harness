import { describe, expect, it } from "vitest";
import {
  formatAgentMemberCard,
  parseAgentMemberCard,
} from "../src/agent-member-card.js";

describe("agent member card", () => {
  it("parses a card and drops appearance", () => {
    const parsed = parseAgentMemberCard({
      kind: "xrk-agent-member",
      name: "Scout",
      playbook: "Read only.",
      role: "researcher",
      appearance: { shape: "star", color: "coral", kitHat: "cap" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card).toEqual({
      name: "Scout",
      playbook: "Read only.",
      role: "researcher",
    });
    expect(formatAgentMemberCard(parsed.card)).not.toContain("appearance");
    expect(formatAgentMemberCard(parsed.card)).toContain("xrk-agent-member");
  });

  it("rejects empty name/playbook and wrong kind", () => {
    expect(
      parseAgentMemberCard({
        kind: "xrk-agent-member",
        name: "",
        playbook: "x",
      }).ok,
    ).toBe(false);
    expect(
      parseAgentMemberCard({
        kind: "xrk-agent-pack",
        name: "X",
        playbook: "y",
      }).ok,
    ).toBe(false);
    expect(parseAgentMemberCard({ name: "X", playbook: "y" }).ok).toBe(false);
    expect(parseAgentMemberCard("not-json").ok).toBe(false);
  });
});
