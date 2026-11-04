/**
 * 座位 → 人：策展记忆的 agent 层跟着「人」走，不跟着「座位」走。
 * 同一个干员在自家办公室与被派出去，必须解析到同一个 memberId。
 */
import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { sessionSeatMemberId } from "../src/agent-home-boundary.js";
import {
  GLOBAL_ROSTER_ID,
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
} from "../src/agent-roster-store.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

async function runtimeAt() {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-seatmem-"));
  const runtime = createFaceRuntime({
    store: createMemorySessionStore(),
    workspaceRoot: root,
    productDir: root,
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
  return { root, runtime };
}

describe("sessionSeatMemberId", () => {
  it("干员办公室与它的派出席解析到同一个人", async () => {
    const { root, runtime } = await runtimeAt();
    runtime.agentRoster.upsert(GLOBAL_ROSTER_ID, {
      id: "mem_coach",
      name: "陪练员",
      playbook: "Coach.",
      role: "worker",
      kind: "advanced",
      ready: true,
    });
    const home = path.join(root, "agent-homes", "mem_coach");
    mkdirSync(home, { recursive: true });
    const { workspace } = runtime.workspaces.ensureAgentHome({
      absPath: home,
      memberId: "mem_coach",
      title: "陪练员",
    });

    // 座位 A：坐在自己办公室里。
    const office = await dispatchFaceMethod(runtime, "session.create", "o", {
      workspaceId: workspace.workspaceId,
      memberId: "mem_coach",
    });
    if (!office.result.ok) throw new Error("office create failed");
    const officeId = (office.result.value as { sessionId: string }).sessionId;
    expect(sessionSeatMemberId(runtime, officeId)).toBe("mem_coach");

    // 座位 B：被派出干活（cwd 仍是父工作区）。
    const dispatched = await dispatchFaceMethod(runtime, "session.create", "d", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!dispatched.result.ok) throw new Error("child create failed");
    const childId = (dispatched.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: officeId,
      childSessionId: childId,
      mode: "continuable",
      label: "陪练员",
      role: "worker",
      memberId: "mem_coach",
    });
    expect(sessionSeatMemberId(runtime, childId)).toBe("mem_coach");
  });

  it("项目工作区顶层会话是经理；向阳是向日葵，两者不混", async () => {
    const { root, runtime } = await runtimeAt();
    const { workspace } = runtime.workspaces.create(path.join(root, "proj"));
    const created = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!created.result.ok) throw new Error("project create failed");
    const projectId = (created.result.value as { sessionId: string }).sessionId;
    expect(sessionSeatMemberId(runtime, projectId)).toBe(MANAGER_MEMBER_ID);

    const xy = await dispatchFaceMethod(runtime, "session.create", "xy", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    expect(xy.result.ok).toBe(true);
    if (!xy.result.ok) return;
    const xyId = (xy.result.value as { sessionId: string }).sessionId;
    expect(sessionSeatMemberId(runtime, xyId)).toBe(SUNFLOWER_MEMBER_ID);
    // 向日葵绝不能继承经理那一层。
    expect(sessionSeatMemberId(runtime, xyId)).not.toBe(MANAGER_MEMBER_ID);
  });

  it("没有身份的派生子会话不冒领经理的 agent 层", async () => {
    const { root, runtime } = await runtimeAt();
    const { workspace } = runtime.workspaces.create(path.join(root, "proj"));
    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!parent.result.ok) throw new Error("parent create failed");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;
    const child = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    if (!child.result.ok) throw new Error("child create failed");
    const childId = (child.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "one-shot",
      label: "tool child",
      role: "worker",
    });
    // 父会话是经理，但子会话本身不是「某个人」——不该读写经理的记忆层。
    expect(sessionSeatMemberId(runtime, parentId)).toBe(MANAGER_MEMBER_ID);
    expect(sessionSeatMemberId(runtime, childId)).toBeUndefined();
  });

  it("委派树共享一个 session 工作台，兄弟会话各自独立", async () => {
    const { root, runtime } = await runtimeAt();
    const { workspace } = runtime.workspaces.create(path.join(root, "proj"));
    const mk = async (ref: string) => {
      const made = await dispatchFaceMethod(runtime, "session.create", ref, {
        workspaceId: workspace.workspaceId,
        agentPreset: "harness",
      });
      if (!made.result.ok) throw new Error(`${ref} create failed`);
      return (made.result.value as { sessionId: string }).sessionId;
    };
    const rootA = await mk("a");
    const childA = await mk("ac");
    const grandA = await mk("ag");
    runtime.subagents.attach({
      parentSessionId: rootA,
      childSessionId: childA,
      mode: "continuable",
      label: "child",
      role: "worker",
    });
    runtime.subagents.attach({
      parentSessionId: childA,
      childSessionId: grandA,
      mode: "continuable",
      label: "grand",
      role: "worker",
    });
    const rootB = await mk("b");

    // 树 A：根、子、孙同一个工作台。
    expect(runtime.subagents.humanFacingSessionId(rootA)).toBe(rootA);
    expect(runtime.subagents.humanFacingSessionId(childA)).toBe(rootA);
    expect(runtime.subagents.humanFacingSessionId(grandA)).toBe(rootA);
    // 树 B 独立。
    expect(runtime.subagents.humanFacingSessionId(rootB)).toBe(rootB);
  });
});
