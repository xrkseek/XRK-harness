import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProposedSkillMarkdown,
  clearLearningLoopNudge,
  consumeLearningLoopNudge,
  createProposeSkillTool,
  learningLoopNudgeText,
  noteLearningLoopTurn,
  resetLearningLoopNudgeStateForTests,
  writeProposedSkill,
  WORKSPACE_SKILLS_REL_DIR,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  resetLearningLoopNudgeStateForTests();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-propose-skill-"));
  roots.push(root);
  await mkdir(path.join(root, WORKSPACE_SKILLS_REL_DIR), { recursive: true });
  return root;
}

describe("propose_skill / learning loop", () => {
  it("builds valid frontmatter and writes after confirm", async () => {
    const root = await workspace();
    const markdown = buildProposedSkillMarkdown({
      name: "office-ping",
      description: "Ping the office printer.",
      body: "# Office ping\n\n## Procedure\n\n1. Call the printer.\n",
    });
    expect(markdown).toContain("name: office-ping");
    expect(markdown).toContain("description: Ping the office printer.");

    const tool = createProposeSkillTool({
      resolveWorkspaceRoot: () => root,
      askConfirm: async (draft) => {
        expect(draft.name).toBe("office-ping");
        expect(draft.targetRel).toBe(".agents/skills/office-ping/SKILL.md");
        expect(draft.markdown).toContain("## Procedure");
        return { approved: true };
      },
    });
    const result = await tool.execute({
      name: "office-ping",
      description: "Ping the office printer.",
      body: "# Office ping\n\n## Procedure\n\n1. Call the printer.\n",
    });
    expect(result.isError).toBeFalsy();
    const written = await readFile(
      path.join(root, WORKSPACE_SKILLS_REL_DIR, "office-ping", "SKILL.md"),
      "utf8",
    );
    expect(written).toContain("Ping the office printer.");
  });

  it("writes workspace scope under the session root and global scope under home .agents", async () => {
    const sessionRoot = await workspace();
    const hostRoot = await workspace();
    const homeSkills = await mkdtemp(path.join(tmpdir(), "xrk-propose-home-"));
    roots.push(homeSkills);
    const tool = createProposeSkillTool({
      resolveWorkspaceRoot: () => sessionRoot,
      resolveGlobalSkillsRoot: () => homeSkills,
      askConfirm: async () => ({ approved: true }),
    });
    const workspaceWrite = await tool.execute({
      name: "fn-job",
      description: "Do the function workspace job.",
      body: "# Job\n\n## Procedure\n\n1. Stay here.\n",
      scope: "workspace",
    });
    expect(workspaceWrite.isError).toBeFalsy();
    expect(JSON.parse(String(workspaceWrite.content)).skillsRoot).toBe(
      path.resolve(sessionRoot, WORKSPACE_SKILLS_REL_DIR),
    );
    await readFile(
      path.join(sessionRoot, WORKSPACE_SKILLS_REL_DIR, "fn-job", "SKILL.md"),
      "utf8",
    );
    expect(
      await readFile(
        path.join(hostRoot, WORKSPACE_SKILLS_REL_DIR, "fn-job", "SKILL.md"),
        "utf8",
      ).catch(() => ""),
    ).toBe("");

    const globalWrite = await tool.execute({
      name: "fn-job",
      description: "Do the function workspace job.",
      body: "# Job\n\n## Procedure\n\n1. Stay global.\n",
      scope: "global",
    });
    expect(globalWrite.isError).toBeFalsy();
    const globalBody = await readFile(path.join(homeSkills, "fn-job", "SKILL.md"), "utf8");
    expect(globalBody).toContain("Stay global.");
    expect(JSON.parse(String(globalWrite.content)).scope).toBe("global");

    const bad = await tool.execute({
      name: "fn-job",
      description: "Do the function workspace job.",
      body: "# Job\n",
      scope: "xiangyang",
    });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("workspace");
  });

  it("refuses to write when the user rejects or confirm is missing", async () => {
    const root = await workspace();
    const rejected = createProposeSkillTool({
      resolveWorkspaceRoot: () => root,
      askConfirm: async () => ({ approved: false, feedback: "not now" }),
    });
    const rejectResult = await rejected.execute({
      name: "nope",
      description: "Should not land.",
      body: "# Nope\n",
    });
    expect(rejectResult.isError).toBeFalsy();
    expect(rejectResult.content).toContain("rejected");

    const unbound = createProposeSkillTool({
      resolveWorkspaceRoot: () => root,
    });
    const unboundResult = await unbound.execute({
      name: "nope",
      description: "Should not land.",
      body: "# Nope\n",
    });
    expect(unboundResult.isError).toBe(true);
    expect(unboundResult.content).toContain("no confirm channel");
  });

  it("writeProposedSkill fail-closes on bad frontmatter", () => {
    expect(() =>
      writeProposedSkill({
        workspaceRoot: "/tmp",
        markdown: "no frontmatter here",
      }),
    ).toThrow(/frontmatter/i);
    expect(() =>
      writeProposedSkill({
        workspaceRoot: "/tmp",
        markdown: "---\nname: bad/name\ndescription: x\n---\n\n# Hi\n",
      }),
    ).toThrow(/invalid skill name/i);
  });

  it("arms a learning-loop nudge after complex turns", () => {
    expect(consumeLearningLoopNudge("s1")).toBe(false);
    noteLearningLoopTurn("s1", 2);
    expect(consumeLearningLoopNudge("s1")).toBe(false);
    noteLearningLoopTurn("s1", 6);
    noteLearningLoopTurn("s1", 6);
    expect(consumeLearningLoopNudge("s1")).toBe(true);
    expect(consumeLearningLoopNudge("s1")).toBe(false);
    expect(learningLoopNudgeText()).toContain("propose_skill");
    noteLearningLoopTurn("s2", 8);
    noteLearningLoopTurn("s2", 8);
    clearLearningLoopNudge("s2");
    expect(consumeLearningLoopNudge("s2")).toBe(false);
  });
});
