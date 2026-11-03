import { describe, expect, it } from "vitest";
import {
  SUBAGENT_ROUTING_PROMPT_TEXT,
  delegationModeLine,
  subagentRoutingPrompt,
} from "../src/subagent-prompt.js";

describe("subagent routing prompt", () => {
  it("covers one-shot, continuable, inherit, worktree, and identity", () => {
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("Continuable (default");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("run_in_background: false");
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
    expect(prompt).toContain("Frugal has no subagent tools");
    expect(prompt).toContain("thread_message");
    expect(prompt).toContain("Do not `thread_switch` to send mail");
    expect(prompt).toContain("auto peer-linked");
    expect(prompt).toContain("close_agent");
    expect(prompt).toContain("only when no catalog member fits");
    expect(prompt).not.toContain("发版");
  });

  it("explains when to end the turn after a background handoff", () => {
    const prompt = subagentRoutingPrompt("proactive");
    expect(prompt).toContain("handed work to a child");
    expect(prompt).toContain("end the turn");
    expect(prompt).toContain("steers a completion notice");
    expect(prompt).toContain("delivery=steer");
  });

  it("tells the parent how to move a child off a dead route", () => {
    const prompt = subagentRoutingPrompt("proactive");
    // The route default and the escape hatch must both be discoverable from
    // the injected prompt — a tool the model never hears about is dead weight.
    expect(prompt).toContain("defaults to this session's current provider");
    expect(prompt).toContain("(QUOTA)");
    expect(prompt).toContain("set_agent_model");
    expect(prompt).toContain("RATE_LIMIT");
    expect(prompt).toContain("is temporary — wait and resend on the same route");
    expect(prompt).toContain("list_models");
  });
});
