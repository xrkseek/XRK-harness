import { describe, expect, it } from "vitest";
import {
  applySpawnRoleReminder,
  applySubagentSpawnPreamble,
  parseAgentTeamSpawnRole,
} from "../src/agent-team-roles.js";
import {
  appendOutputContract,
  coerceOutputSchema,
  extractJsonCandidate,
  validateOutputAgainstSchema,
} from "../src/agent-team-output.js";
import { AgentTeamTaskBoard } from "../src/agent-team-tasks.js";

describe("agent team spawn roles", () => {
  it("parses Codex-style agent_type aliases", () => {
    expect(parseAgentTeamSpawnRole("worker")).toBe("worker");
    expect(parseAgentTeamSpawnRole("Researcher")).toBe("researcher");
    expect(parseAgentTeamSpawnRole("default")).toBe("default");
    expect(parseAgentTeamSpawnRole("nope")).toBeUndefined();
  });

  it("prefixes non-default role reminders", () => {
    const out = applySpawnRoleReminder("Do the thing.", "reviewer");
    expect(out.startsWith("ROLE: reviewer.")).toBe(true);
    expect(out).toContain("Do the thing.");
    expect(applySpawnRoleReminder("x", "default")).toBe("x");
  });

  it("prefixes parent/child identity for every spawn shape", () => {
    const oneShot = applySubagentSpawnPreamble({
      prompt: "Review src/foo.ts",
      parentSessionId: "sess_parent",
      childSessionId: "sess_child",
      mode: "one-shot",
      label: "review",
      role: "reviewer",
      inheritContext: false,
      cwd: "/repo",
      isolatedWorktree: false,
    });
    expect(oneShot).toContain("[subagent identity]");
    expect(oneShot).toContain("parent_session_id: sess_parent");
    expect(oneShot).toContain("your_session_id: sess_child");
    expect(oneShot).toContain("one-shot");
    expect(oneShot).toContain("ROLE: reviewer.");
    expect(oneShot).toContain("same as the parent session");
    expect(oneShot).toContain("Review src/foo.ts");
    expect(oneShot).not.toMatch(/read AGENTS\.md to discover/i);

    const companion = applySubagentSpawnPreamble({
      prompt: "You are chat companion Xiao Ai.",
      parentSessionId: "sess_parent",
      childSessionId: "sess_ai",
      mode: "continuable",
      label: "聊天伙伴小艾",
      inheritContext: false,
      cwd: "/repo",
      isolatedWorktree: false,
    });
    expect(companion).toContain("continuable");
    expect(companion).toContain("role: default");
    expect(companion).toContain("You are chat companion Xiao Ai.");

    const inherited = applySubagentSpawnPreamble({
      prompt: "Continue the last completed plan.",
      parentSessionId: "p",
      childSessionId: "c",
      mode: "continuable",
      label: "forked",
      inheritContext: true,
      cwd: "/repo",
      isolatedWorktree: false,
    });
    expect(inherited).toContain("seeded completed parent turns");

    const worktree = applySubagentSpawnPreamble({
      prompt: "Patch in isolation.",
      parentSessionId: "p",
      childSessionId: "c",
      mode: "one-shot",
      label: "wt",
      role: "worker",
      inheritContext: false,
      cwd: "/repo/.xrk/worktrees/c",
      isolatedWorktree: true,
    });
    expect(worktree).toContain("isolated git worktree");
    expect(worktree).toContain("ROLE: worker.");

    const member = applySubagentSpawnPreamble({
      prompt: "Ship v0.5.11",
      parentSessionId: "p",
      childSessionId: "c",
      mode: "continuable",
      label: "发版干员",
      role: "worker",
      inheritContext: false,
      cwd: "/repo",
      isolatedWorktree: false,
      memberId: "mem_seed_release",
      inject: "minimal",
    });
    expect(member).toContain("member_id: mem_seed_release");
    expect(member).toContain("inject: minimal");
  });
});

describe("agent team output contract", () => {
  it("coerces and validates required JSON fields", () => {
    const coerced = coerceOutputSchema({
      type: "object",
      required: ["summary"],
    });
    expect(coerced.schema).toBeTruthy();
    const schema = coerced.schema!;
    const prompt = appendOutputContract("Task body", schema);
    expect(prompt).toContain("OUTPUT CONTRACT");
    expect(prompt).toContain('"required"');

    expect(extractJsonCandidate('here {"summary":"ok"} end')).toBe(
      '{"summary":"ok"}',
    );
    expect(
      validateOutputAgainstSchema('{"summary":"ok"}', schema).valid,
    ).toBe(true);
    expect(
      validateOutputAgainstSchema('{"other":1}', schema).valid,
    ).toBe(false);
  });
});

describe("agent team task board", () => {
  it("tracks delivery · complete · takeover · resume", () => {
    const board = new AgentTeamTaskBoard();
    const task = board.open({
      parentSessionId: "parent",
      title: "investigate",
      childSessionId: "child-1",
      role: "researcher",
      taskId: "task_demo",
    });
    expect(task.status).toBe("in_progress");
    expect(board.list("parent")).toHaveLength(1);

    board.setOutputSchema(task.id, {
      type: "object",
      required: ["ok"],
    });
    expect(board.outputSchemaForChild("child-1")).toMatchObject({
      required: ["ok"],
    });

    const paused = board.markTakeover("child-1");
    expect(paused?.status).toBe("paused");
    expect(paused?.humanOwned).toBe(true);

    const resumed = board.markResumed("child-1");
    expect(resumed?.status).toBe("in_progress");
    expect(resumed?.humanOwned).toBe(false);

    board.bindWorktree(task.id, {
      path: "/tmp/wt-demo",
      branch: "agent/task_demo",
      id: "wt1",
    });
    expect(board.get(task.id)?.worktreeBranch).toBe("agent/task_demo");

    const done = board.complete(task.id, {
      ok: true,
      preview: '{"ok":true}',
      schemaValid: true,
    });
    expect(done?.status).toBe("completed");
    expect(done?.schemaValid).toBe(true);
    expect(done?.resultPreview).toContain('"ok":true');
    expect(done?.revision).toBeGreaterThan(task.revision);
  });
});
