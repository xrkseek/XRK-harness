import { describe, expect, it } from "vitest";
import {
  createStdTools,
  createToolRegistry,
  runToolDetailed,
} from "../src/index.js";

describe("todo_write toolEvents", () => {
  it("emits todo/write side event for standing plan", async () => {
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const out = await runToolDetailed({
      registry: tools,
      call: {
        id: "c1",
        name: "todo_write",
        arguments: {
          todos: [
            { id: "1", content: "wire todos", status: "in_progress" },
            { id: "2", content: "docs", status: "pending" },
          ],
        },
      },
    });
    expect(out.toolEvents).toEqual([
      {
        type: "todo/write",
        payload: {
          todos: [
            { content: "wire todos", status: "in_progress" },
            { content: "docs", status: "pending" },
          ],
        },
      },
    ]);
  });
});

describe("exit_plan_mode", () => {
  it("rejects outside plan mode and without a heading", async () => {
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const inactive = await runToolDetailed({
      registry: tools,
      call: {
        id: "c1",
        name: "exit_plan_mode",
        arguments: { plan: "# Title\n\nBody" },
      },
    });
    expect(inactive.result.isError).toBe(true);
    expect(inactive.result.content).toContain("only available in plan mode");
  });

  it("emits plan/mode on approved review", async () => {
    const tools = createToolRegistry();
    for (const t of createStdTools({
      isPlanModeActive: () => true,
      askPlanReview: async () => ({ approved: true }),
    })) {
      tools.register(t);
    }
    const missingHeading = await runToolDetailed({
      registry: tools,
      call: {
        id: "c0",
        name: "exit_plan_mode",
        arguments: { plan: "no heading" },
      },
    });
    expect(missingHeading.result.isError).toBe(true);

    const out = await runToolDetailed({
      registry: tools,
      call: {
        id: "c1",
        name: "exit_plan_mode",
        arguments: { plan: "# Ship\n\nGo." },
      },
    });
    expect(out.result.isError).toBeFalsy();
    expect(out.toolEvents).toEqual([{ type: "plan/mode", payload: { active: false } }]);
  });
});
