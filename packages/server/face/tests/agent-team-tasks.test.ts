import { describe, expect, it } from "vitest";
import {
  applySpawnRoleReminder,
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

    const done = board.complete(task.id, {
      ok: true,
      preview: '{"ok":true}',
      schemaValid: true,
    });
    expect(done?.status).toBe("completed");
    expect(done?.schemaValid).toBe(true);
    expect(done?.revision).toBeGreaterThan(task.revision);
  });
});
