import { describe, expect, it } from "vitest";
import { createToolRegistry, materializeTools } from "@xrkseek/core-tools";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import type { AgentHandle } from "@xrkseek/core-agent";

/**
 * The per-session Face tools that used to be missing whenever Host drove a turn
 * without Face `resolveAgent` (`createDrain` — slash `agent.steer`, cron admits,
 * subagent + job notices, cross-session `thread_message`). Symptom: the model
 * sees them in the system prompt, calls one, and gets `Unknown tool:
 * presence_set`.
 */
const FACE_SESSION_TOOLS = [
  "canvas_delete",
  "canvas_list",
  "canvas_patch",
  "canvas_read",
  "canvas_upsert",
  "get_goal",
  "update_goal",
  "presence_set",
  "sideline_set",
  "team_list",
  "team_save",
  "thread_delete",
  "thread_list",
  "thread_message",
  "thread_switch",
  "thread_upsert",
];

/** Agent shaped like the Host factory's: tools + a jobs registry. */
function hostShapedAgent(tools: ReturnType<typeof createToolRegistry>): AgentHandle {
  return {
    tools,
    jobs: {
      list: () => [],
      onJobsChanged: () => () => {},
    },
    admit() {},
    pendingAdmits: () => [],
    isBusy: () => false,
    abort() {},
    setApprovalHandler() {},
  } as unknown as AgentHandle;
}

describe("FaceRuntime.bindSessionAgent", () => {
  it("binds the full Face tool set on a Host-resolved agent", () => {
    const runtime = createBareFaceRuntime();
    const tools = createToolRegistry();
    // Host rebuilds the agent on the drain path — no resolveAgent in sight.
    runtime.bindSessionAgent("sess-host", hostShapedAgent(tools));
    expect(FACE_SESSION_TOOLS.filter((name) => !tools.get(name))).toEqual([]);
  });

  it("is idempotent per registry and keeps tool identity (no stale settle)", async () => {
    const runtime = createBareFaceRuntime();
    const tools = createToolRegistry();
    runtime.bindSessionAgent("sess-a", hostShapedAgent(tools));
    const table = materializeTools(tools);
    const presence = tools.get("presence_set");
    const settings = tools.get("settings_get");

    // A second pass (Face resolveAgent after Host's bind) must not re-mint
    // definitions — settle answers "Stale tool call" when identity moves.
    runtime.bindSessionAgent("sess-a", hostShapedAgent(tools));
    expect(tools.get("presence_set")).toBe(presence);
    expect(tools.get("settings_get")).toBe(settings);

    const settled = await table.settle({
      call: {
        id: "c1",
        name: "presence_set",
        arguments: { emotionId: "33", tips: "绑好了" },
      },
    });
    expect(settled.result.content).not.toContain("Stale tool call");
    expect(settled.result.isError).toBeFalsy();
    expect(runtime.presence.get("sess-a")?.emotionId).toBe("33");
  });

  it("subscribes job notices for Host-resolved agents too", () => {
    const runtime = createBareFaceRuntime();
    const tools = createToolRegistry();
    let subscribed = 0;
    const agent = {
      ...hostShapedAgent(tools),
      jobs: {
        list: () => [],
        onJobsChanged: () => {
          subscribed += 1;
          return () => {};
        },
      },
    } as unknown as AgentHandle;

    runtime.bindSessionAgent("sess-jobs", agent);
    expect(subscribed).toBe(1);
    // Re-resolve replaces the subscription, never stacks a second listener.
    runtime.bindSessionAgent("sess-jobs", agent);
    expect(subscribed).toBe(2);
  });

  it("keeps child sessions off parent-facing thread tools", () => {
    const runtime = createBareFaceRuntime();
    const tools = createToolRegistry();
    runtime.subagents.attach({
      childSessionId: "sess-child",
      parentSessionId: "sess-parent",
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
    } as never);
    runtime.bindSessionAgent("sess-child", hostShapedAgent(tools));
    expect(tools.get("thread_upsert")).toBeUndefined();
    expect(tools.get("team_save")).toBeUndefined();
    expect(tools.get("presence_set")).toBeDefined();
  });
});
