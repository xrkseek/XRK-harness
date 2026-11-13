/**
 * 同一个干员，两种座位：agent-home 常驻（老板直接对话）与 subagent 派出
 *（派它的人对话）。公文包、材料、技能一致；工具面与 ask 通道按实时事实
 *（子会话链接 / 角色下限 / 会话 lane）推导，不按车道各写一套。
 */
import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { formatSessionCapability } from "../src/session-capability.js";
import { bindWorkspaceOrchestrateTools } from "../src/workspace-orchestrate-tools.js";
import { GLOBAL_ROSTER_ID } from "../src/agent-roster-store.js";
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

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-seat-"));
  const runtime = createFaceRuntime({
    store: createMemorySessionStore(),
    workspaceRoot: root,
    productDir: root,
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
  runtime.agentRoster.upsert(GLOBAL_ROSTER_ID, {
    id: "mem_coach",
    name: "陪练员",
    playbook: "Coach speaking.",
    role: "worker",
    kind: "advanced",
    ready: true,
  });
  const packHome = path.join(root, "agent-rosters", "packs", "global", "mem_coach");
  mkdirSync(path.join(packHome, "workspace"), { recursive: true });
  mkdirSync(path.join(packHome, "skills", "coach-core"), { recursive: true });
  const home = path.join(root, "agent-homes", "mem_coach");
  mkdirSync(home, { recursive: true });
  const { workspace } = runtime.workspaces.ensureAgentHome({
    absPath: home,
    memberId: "mem_coach",
    title: "陪练员",
  });
  const created = await dispatchFaceMethod(runtime, "session.create", "c", {
    workspaceId: workspace.workspaceId,
    memberId: "mem_coach",
  });
  if (!created.result.ok) throw new Error("identity session create failed");
  const homeSessionId = (created.result.value as { sessionId: string }).sessionId;
  return { root, runtime, packHome, home: workspace, homeSessionId };
}

describe("干员两种座位的上下文工程", () => {
  it("公文包行在常驻席与派出席完全同款（不按任务裁剪）", async () => {
    const { runtime, packHome, homeSessionId, home } = await setup();
    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: home.workspaceId,
      memberId: "mem_coach",
    });
    if (!parent.result.ok) throw new Error("parent create failed");
    const parentId = (parent.result.value as { sessionId: string }).sessionId;
    const child = await dispatchFaceMethod(runtime, "session.create", "ch", {
      workspaceId: home.workspaceId,
    });
    if (!child.result.ok) throw new Error("child create failed");
    const childId = (child.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
      label: "陪练员",
      role: "worker",
      memberId: "mem_coach",
    });

    const homeText = formatSessionCapability(runtime, homeSessionId);
    const childText = formatSessionCapability(runtime, childId);

    for (const text of [homeText, childText]) {
      expect(text).toContain(`pack_home: ${packHome}`);
      expect(text).toContain(`skills_dir: ${path.join(packHome, "skills")}`);
      expect(text).toContain(`materials: ${path.join(packHome, "workspace")}`);
    }
    // 派出席额外给出 lane/角色事实，常驻席不该有委派话术。
    expect(childText).toContain("kind: delegated_child");
    expect(homeText).not.toContain("kind: delegated_child");
    expect(homeText).not.toContain("FINAL→parent");
  });

  it("ask 通道随座位推导：常驻→老板，派出→派它的人", async () => {
    const { runtime, homeSessionId, home } = await setup();
    expect(formatSessionCapability(runtime, homeSessionId)).toContain(
      "ask: ask_user→boss",
    );

    const child = await dispatchFaceMethod(runtime, "session.create", "ch", {
      workspaceId: home.workspaceId,
    });
    if (!child.result.ok) throw new Error("child create failed");
    const childId = (child.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: homeSessionId,
      childSessionId: childId,
      mode: "continuable",
      label: "陪练员",
      role: "worker",
      memberId: "mem_coach",
    });
    const childText = formatSessionCapability(runtime, childId);
    expect(childText).toContain(`ask: ask→${homeSessionId}`);
    expect(childText).toContain("answer_ask");
    expect(childText).not.toContain("ask_user→boss");
  });

  it("agent-home 席位开出的会话是那位同事的身份席，不是无名通用会话", async () => {
    const { runtime, homeSessionId } = await setup();
    runtime.agentRoster.upsert(GLOBAL_ROSTER_ID, {
      id: "mem_peer",
      name: "同事",
      playbook: "Peer.",
      role: "worker",
      kind: "advanced",
      ready: true,
    });
    const peerHome = path.join(tmpdir(), `xrk-peer-${Date.now()}`);
    mkdirSync(peerHome, { recursive: true });
    const { workspace: peerWs } = runtime.workspaces.ensureAgentHome({
      absPath: peerHome,
      memberId: "mem_peer",
      title: "同事",
    });

    // The mint path itself is asserted on the create call the tool makes
    // (prompt delivery needs a live agent, out of scope for a context test).
    const created = await dispatchFaceMethod(runtime, "session.create", "probe", {
      workspaceId: peerWs.workspaceId,
      memberId: "mem_peer",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const peerSessionId = (created.result.value as { sessionId: string }).sessionId;
    expect(runtime.sessionIdentities.get(peerSessionId)?.memberId).toBe("mem_peer");

    // A shared tool registry is mounted for the calling seat.
    const tools = createToolRegistry();
    bindWorkspaceOrchestrateTools(tools, {
      runtime,
      sessionId: homeSessionId,
      mode: "coding",
    });
    expect(tools.get("workspace_session_prompt")).toBeTruthy();

    // The mock agent cannot run a turn, so delivery fails at the prompt step —
    // what matters here is that the gate no longer refuses agent-home.
    const out = await tools
      .get("workspace_session_prompt")!
      .execute(
        { workspace_id: peerWs.workspaceId, prompt: "你好", wait: false },
        new AbortController().signal,
      );
    expect(String(out.content)).not.toMatch(/refuse agent-home/);
  });

  it("项目席仍被拒绝开干员工作区（lane 不松动）", async () => {
    const { runtime, home, root } = await setup();
    const { workspace: projectWs } = runtime.workspaces.create(
      path.join(root, "proj"),
    );
    const parent = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: projectWs.workspaceId,
      agentPreset: "harness",
    });
    if (!parent.result.ok) throw new Error("project create failed");
    const projectId = (parent.result.value as { sessionId: string }).sessionId;

    const tools = createToolRegistry();
    bindWorkspaceOrchestrateTools(tools, {
      runtime,
      sessionId: projectId,
      mode: "coding",
    });
    const refused = await tools
      .get("workspace_session_prompt")!
      .execute(
        { workspace_id: home.workspaceId, prompt: "hi", wait: false },
        new AbortController().signal,
      );
    expect(refused.isError).toBe(true);
    expect(String(refused.content)).toMatch(/refuse agent-home/);
  });

  it("workspace_list 只列出本 lane 能进的房间", async () => {
    const { runtime, homeSessionId, root } = await setup();
    const { workspace: projectWs } = runtime.workspaces.create(
      path.join(root, "proj"),
    );
    const projectWsId = projectWs.workspaceId;

    const homeTools = createToolRegistry();
    bindWorkspaceOrchestrateTools(homeTools, {
      runtime,
      sessionId: homeSessionId,
      mode: "coding",
    });
    const listed = await homeTools
      .get("workspace_list")!
      .execute({}, new AbortController().signal);
    const homeBody = JSON.parse(String(listed.content)) as {
      items: Array<{ workspaceId: string; member?: string | null; im?: boolean }>;
    };
    expect(homeBody.items.length).toBeGreaterThan(0);
    expect(homeBody.items.every((row) => row.member !== undefined)).toBe(true);
    // Project-only fields must not leak into an office listing.
    expect(homeBody.items.every((row) => row.im === undefined)).toBe(true);
    expect(
      homeBody.items.every((row) => row.workspaceId !== projectWsId),
    ).toBe(true);
  });
});
