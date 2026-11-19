import { describe, expect, it } from "vitest";
import {
  SUBAGENT_ROUTING_PROMPT_TEXT,
  delegationModeLine,
  subagentRoutingPrompt,
} from "../src/subagent-prompt.js";

describe("subagent routing prompt", () => {
  it("covers one-shot, continuable, inherit, worktree, and identity", () => {
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("continuable default");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("run_in_background: false");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("inherit_context: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("worktree: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("same cwd");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("workspace_id");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain(
      "never tell the child to read AGENTS.md",
    );
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("followup_task");
  });

  it("renders mutually exclusive delegation modes", () => {
    const explicit = delegationModeLine("explicit");
    const proactive = delegationModeLine("proactive");
    expect(explicit).toContain("explicit only");
    expect(explicit).toContain("NOT authorization");
    expect(proactive).toContain("proactive");
    expect(proactive).toContain("genuinely helps");
    // Exactly one posture is ever in the assembled prompt.
    const assembled = subagentRoutingPrompt("explicit");
    expect(assembled).toContain("explicit only");
    expect(assembled).not.toContain("genuinely helps");
  });

  it("carries the delegation decision rules (plan first, disjoint scopes)", () => {
    const prompt = subagentRoutingPrompt("proactive");
    expect(prompt).toContain("high-level plan");
    expect(prompt).toContain("disjoint scopes");
    expect(prompt).toContain("member_id");
    expect(prompt).toContain("Frugal");
    expect(prompt).toContain("thread_message");
    expect(prompt).toContain("thread_switch");
    expect(prompt).toContain("close_agent");
    expect(prompt).toContain("no catalog match");
    expect(prompt).not.toContain("发版");
  });

  it("explains when to end the turn after a background handoff", () => {
    const prompt = subagentRoutingPrompt("proactive");
    expect(prompt).toContain("After handoff");
    expect(prompt).toContain("end the turn");
    expect(prompt).toContain("completion notice");
    expect(prompt).toContain("delivery=steer");
  });

  it("tells the parent how to move a child off a dead route", () => {
    const prompt = subagentRoutingPrompt("proactive");
    expect(prompt).toContain("defaults to this session");
    expect(prompt).toContain("(QUOTA)");
    expect(prompt).toContain("set_agent_model");
    expect(prompt).toContain("RATE_LIMIT");
    expect(prompt).toContain("list_models");
  });

  it("stays short — contracts live on tool schemas", () => {
    // First-turn diet: keep under ~2k chars (was ~4.5k+).
    expect(SUBAGENT_ROUTING_PROMPT_TEXT.length).toBeLessThan(2200);
  });
});
