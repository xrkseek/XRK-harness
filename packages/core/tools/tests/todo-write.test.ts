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

describe("settings_get / settings_mutate", () => {
  it("errors when Face channel is unbound", async () => {
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const get = await runToolDetailed({
      registry: tools,
      call: { id: "c1", name: "settings_get", arguments: {} },
    });
    expect(get.result.isError).toBe(true);
    expect(get.result.content).toContain("unavailable");

    const mut = await runToolDetailed({
      registry: tools,
      call: {
        id: "c2",
        name: "settings_mutate",
        arguments: {
          ns: "mcp",
          ops: [{ op: "set", path: ["allowConnect"], value: true }],
        },
      },
    });
    expect(mut.result.isError).toBe(true);
  });

  it("mutates and surfaces mcp connect failures", async () => {
    const tools = createToolRegistry();
    for (const t of createStdTools({
      settingsGet: async (ns) => ({
        ok: true,
        message: ns ? `ns=${ns}` : "list",
        payload: ns ? { ns, value: { allowConnect: false } } : [{ ns: "mcp" }],
      }),
      settingsMutate: async (ns, ops) => {
        expect(ns).toBe("mcp");
        expect(ops[0]?.path).toEqual(["servers"]);
        return {
          ok: true,
          message: "settings.mutate ns=mcp ok",
          failures: [{ serverName: "demo", message: "spawn failed" }],
        };
      },
    })) {
      tools.register(t);
    }
    const okGet = await runToolDetailed({
      registry: tools,
      call: { id: "g1", name: "settings_get", arguments: { ns: "mcp" } },
    });
    expect(okGet.result.isError).toBeFalsy();
    expect(okGet.result.content).toContain("allowConnect");

    const fail = await runToolDetailed({
      registry: tools,
      call: {
        id: "m1",
        name: "settings_mutate",
        arguments: {
          ns: "mcp",
          ops: [
            {
              op: "set",
              path: ["servers"],
              value: [{ serverName: "demo", command: "npx" }],
            },
          ],
        },
      },
    });
    expect(fail.result.isError).toBe(true);
    expect(fail.result.content).toContain("spawn failed");
  });
});
