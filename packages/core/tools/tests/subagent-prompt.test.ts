import { describe, expect, it } from "vitest";
import {
  SUBAGENT_ROUTING_PROMPT_TEXT,
  delegationModeLine,
  subagentRoutingPrompt,
} from "../src/subagent-prompt.js";

describe("subagent routing prompt", () => {
  it("covers one-shot, continuable, inherit, worktree, and identity", () => {
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("run_in_background: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("inherit_context: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("worktree: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("same cwd");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("never tell the child to read AGENTS.md");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("followup_task");
  });

  it("renders mutually exclusive delegation modes", () => {
    const explicit = delegationModeLine("explicit");
    const proactive = delegationModeLine("proactive");
    expect(explicit).toContain("explicit only");
    expect(explicit).toContain("NOT authorization");
    expect(proactive).toContain("proactive");
    expect(proactive).toContain("approved strategy");
    // Exactly one posture is ever in the assembled prompt.
    const assembled = subagentRoutingPrompt("explicit");
    expect(assembled).toContain("explicit only");
    expect(assembled).not.toContain("approved strategy");
  });

  it("carries the delegation decision rules (plan first, disjoint scopes)", () => {
    const prompt = subagentRoutingPrompt("proactive");
    expect(prompt).toContain("high-level plan");
    expect(prompt).toContain("critical path");
    expect(prompt).toContain("disjoint scopes");
    expect(prompt).toContain("member_id");
  });
});
