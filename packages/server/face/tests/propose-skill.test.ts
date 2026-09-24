import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createProposeSkillTool, PROPOSE_SKILL_TOOL } from "@xrkseek/workspace";
import {
  bindProposeSkillTool,
  PROPOSE_SKILL_APPROVE_LABEL,
  PROPOSE_SKILL_QUESTION_ID,
  proposeSkillQuestions,
} from "../src/propose-skill.js";

describe("bindProposeSkillTool", () => {
  it("builds a confirm question with the draft markdown", () => {
    const qs = proposeSkillQuestions({
      name: "demo",
      description: "Demo skill.",
      body: "# Demo",
      markdown: "---\nname: demo\ndescription: Demo skill.\n---\n\n# Demo\n",
      targetRel: ".agents/skills/demo/SKILL.md",
    });
    expect(qs[0]?.id).toBe(PROPOSE_SKILL_QUESTION_ID);
    expect(qs[0]?.detail).toContain("name: demo");
    expect(qs[0]?.options?.[0]?.label).toBe(PROPOSE_SKILL_APPROVE_LABEL);
  });

  it("wires askConfirm through Face questions", async () => {
    const tools = createToolRegistry();
    tools.register(
      createProposeSkillTool({
        resolveWorkspaceRoot: () => process.cwd(),
      }),
    );
    const ask = vi.fn(async () => ({
      answers: [
        {
          id: PROPOSE_SKILL_QUESTION_ID,
          selected: [PROPOSE_SKILL_APPROVE_LABEL] as const,
        },
      ],
    }));
    bindProposeSkillTool(tools, {
      workspaceRoot: process.cwd(),
      sessionId: "sess-1",
      ask,
    });
    const tool = tools.get(PROPOSE_SKILL_TOOL);
    expect(tool).toBeDefined();
    // Reject path without writing: ask returns Reject.
    ask.mockResolvedValueOnce({
      answers: [
        {
          id: PROPOSE_SKILL_QUESTION_ID,
          selected: ["Reject"] as const,
        },
      ],
    });
    const result = await tool!.execute({
      name: "demo-skill",
      description: "Demo only.",
      body: "# Demo\n\nProcedure.\n",
    });
    expect(ask).toHaveBeenCalled();
    expect(result.content).toMatch(/rejected|nothing was written/i);
  });
});
