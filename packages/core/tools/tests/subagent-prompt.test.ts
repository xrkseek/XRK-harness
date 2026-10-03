import { describe, expect, it } from "vitest";
import { SUBAGENT_ROUTING_PROMPT_TEXT } from "../src/subagent-prompt.js";

describe("subagent routing prompt", () => {
  it("covers one-shot, continuable, inherit, worktree, and identity", () => {
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("run_in_background: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("inherit_context: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("worktree: true");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("same cwd");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("never tell the child to read AGENTS.md");
    expect(SUBAGENT_ROUTING_PROMPT_TEXT).toContain("followup_task");
  });
});
