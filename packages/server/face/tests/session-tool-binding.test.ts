import { describe, expect, it } from "vitest";
import { createToolRegistry, materializeTools } from "@xrkseek/core-tools";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import type { AgentHandle } from "@xrkseek/core-agent";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  sessionCreatedByBoss,
} from "../src/session-opener.js";

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
  "team_list",
  "team_save",
  "team_import",
  "team_ready",
  "thread_delete",
  "thread_list",
  "thread_message",
  "thread_switch",
  "thread_upsert",
  "workspace_list",
  // workspace_create stays on 向阳 admin — coding 经理席 is create-light.
  "workspace_session_prompt",
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
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "harness" });
    const tools = createToolRegistry();
    // Host rebuilds the agent on the drain path — no resolveAgent in sight.
    runtime.bindSessionAgent("sess-host", hostShapedAgent(tools));
    expect(FACE_SESSION_TOOLS.filter((name) => !tools.get(name))).toEqual([]);
  });

  it("keeps minimal badge off peer workspace/thread tools", () => {
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "minimal" });
    const tools = createToolRegistry();
    runtime.bindSessionAgent("sess-min", hostShapedAgent(tools));
    expect(tools.get("workspace_list")).toBeUndefined();
    expect(tools.get("thread_message")).toBeUndefined();
    // PI / minimal = fs+session only — no presence / peer tools.
    expect(tools.get("presence_set")).toBeUndefined();
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

  it("gives peer-collab children ownLane thread tools (not parent pin of peers)", () => {
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "harness" });
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
    // Own 主线 for discovery — not messageOnly.
    expect(tools.get("thread_upsert")).toBeDefined();
    expect(tools.get("thread_list")).toBeDefined();
    expect(tools.get("thread_message")).toBeDefined();
    expect(tools.get("team_save")).toBeUndefined();
    expect(tools.get("team_import")).toBeUndefined();
    expect(tools.get("ask")).toBeDefined();
    expect(tools.get("ask_user")).toBeUndefined();
    expect(tools.get("settings_mutate")).toBeUndefined();
    expect(tools.get("canvas_upsert")).toBeUndefined();
    expect(tools.get("propose_skill")).toBeUndefined();
    expect(tools.get("workspace_create")).toBeUndefined();
    expect(tools.get("workspace_list")).toBeUndefined();
    expect(tools.get("workspace_session_prompt")).toBeUndefined();
    expect(tools.get("presence_set")).toBeDefined();
    expect(tools.get("team_list")).toBeDefined();
  });

  it("strips voice tools when seat was opened by another seat (not 老板-created)", async () => {
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "harness" });
    const openerRes = await dispatchFaceMethod(runtime, "session.create", "o", {});
    expect(openerRes.result.ok).toBe(true);
    if (!openerRes.result.ok) return;
    const openerId = (openerRes.result.value as { sessionId: string }).sessionId;
    const coding = runtime.workspaces.create(
      `${runtime.workspaceRoot}/voice-peer`,
    ).workspace;
    const peerRes = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: coding.workspaceId,
      inheritFrom: openerId,
    });
    expect(peerRes.result.ok).toBe(true);
    if (!peerRes.result.ok) return;
    const peerId = (peerRes.result.value as { sessionId: string }).sessionId;
    expect(sessionCreatedByBoss(runtime, peerId)).toBe(false);
    expect(sessionCreatedByBoss(runtime, openerId)).toBe(true);

    const tools = createToolRegistry();
    tools.register({
      name: "text_to_speech",
      description: "speak",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "ok" }),
    });
    tools.register({
      name: "voice_transcribe",
      description: "listen",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "ok" }),
    });
    runtime.bindSessionAgent(peerId, hostShapedAgent(tools));
    expect(tools.get("text_to_speech")).toBeUndefined();
    expect(tools.get("voice_transcribe")).toBeUndefined();
  });

  it("keeps minimal-badge children off peer thread tools", () => {
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "minimal" });
    const tools = createToolRegistry();
    runtime.subagents.attach({
      childSessionId: "sess-min-child",
      parentSessionId: "sess-min-parent",
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
    } as never);
    runtime.bindSessionAgent("sess-min-child", hostShapedAgent(tools));
    expect(tools.get("thread_upsert")).toBeUndefined();
    expect(tools.get("thread_message")).toBeUndefined();
  });

  it("gives agent-home identity seats team_list + team_self (not full mint)", () => {
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "harness" });
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Home Scout",
        playbook: "Stay home.",
        role: "worker",
      },
    );
    expect(member).toBeTruthy();
    runtime.sessionIdentities.bind({
      sessionId: "sess-home",
      memberId: member!.id,
      workspaceId: runtime.workspaces.defaultId(),
    });
    const tools = createToolRegistry();
    runtime.bindSessionAgent("sess-home", hostShapedAgent(tools));
    expect(tools.get("team_list")).toBeDefined();
    expect(tools.get("team_self")).toBeDefined();
    expect(tools.get("team_save")).toBeUndefined();
    expect(tools.get("team_import")).toBeUndefined();
    expect(tools.get("team_remove")).toBeUndefined();
  });

  it("gives member_id children team_self even when office is off (minimal)", () => {
    const runtime = createBareFaceRuntime({ defaultAgentPreset: "minimal" });
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Thin Scout",
        playbook: "Thin.",
        role: "worker",
      },
    );
    expect(member).toBeTruthy();
    runtime.subagents.attach({
      childSessionId: "sess-mem-child",
      parentSessionId: "sess-mem-parent",
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
      memberId: member!.id,
    } as never);
    const tools = createToolRegistry();
    runtime.bindSessionAgent("sess-mem-child", hostShapedAgent(tools));
    expect(tools.get("team_list")).toBeDefined();
    expect(tools.get("team_self")).toBeDefined();
    expect(tools.get("team_save")).toBeUndefined();
  });
});
