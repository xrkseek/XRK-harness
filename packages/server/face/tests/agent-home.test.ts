import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import {
  agentHomeDir,
  mintAgentHomeForMember,
  unbindAgentHomeForMember,
} from "../src/agent-home.js";
import { refuseCrossAgentHomeLane } from "../src/agent-home-boundary.js";
import { sessionCreate } from "../src/handlers/session.js";
import { workspaceDeleteFace } from "../src/workspace-face.js";

describe("agent-home + identity session", () => {
  it("mints agent-home workspace and AGENTS.md on explicit add", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Scout",
      playbook: "You are Scout. Gather facts only.",
      role: "researcher",
    });
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const row = runtime.workspaces.get(home.workspaceId);
    expect(row?.kind).toBe("agent-home");
    expect(row?.boundMemberId).toBe(member!.id);
    const dir = agentHomeDir(member!.id, runtime.agentRoster.home);
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("Scout");
  });

  it("creates a top-level identity session on agent-home", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Worker",
      playbook: "Ship carefully.",
      role: "worker",
    });
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const created = await sessionCreate(runtime, "t1", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String(
      (created.value as { sessionId?: string }).sessionId ?? "",
    );
    expect(runtime.sessionIdentities.get(sessionId)?.memberId).toBe(member!.id);
    expect(runtime.subagents.getByChild(sessionId)).toBeUndefined();
  });

  it("rejects identity create when workspace is not that member home", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Worker",
      playbook: "Ship carefully.",
      role: "worker",
    });
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const other = path.join(runtime.productDir!, "other-project");
    mkdirSync(other, { recursive: true });
    const project = runtime.workspaces.create(other);
    const created = await sessionCreate(runtime, "t2", {
      workspaceId: project.workspace.workspaceId,
      memberId: member!.id,
    });
    expect(created.ok).toBe(false);
  });

  it("ungroups identity sessions on agent-home delete (not archive)", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Clerk",
      playbook: "File things.",
      role: "worker",
    });
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const created = await sessionCreate(runtime, "t3", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String(
      (created.value as { sessionId?: string }).sessionId ?? "",
    );
    expect(runtime.workspaces.workspaceIdOf(sessionId)).toBe(home.workspaceId);

    const deleted = await workspaceDeleteFace(runtime, {
      workspaceId: home.workspaceId,
    });
    expect(deleted.ok).toBe(true);
    expect(runtime.workspaces.get(home.workspaceId)).toBeUndefined();
    expect(runtime.workspaces.workspaceIdOf(sessionId)).toBeUndefined();
    // Keep identity so session.list memberId routes the orphan to 干员「未分组」.
    expect(runtime.sessionIdentities.get(sessionId)?.memberId).toBe(member!.id);
    const listed = runtime.workspaces.list(runtime.store.list());
    expect(listed.archivedSessionIds).not.toContain(sessionId);
    // Unbound → 干员「未分组」; still absent from every workspace row.
    expect(listed.items.every((row) => !row.sessionIds.includes(sessionId))).toBe(
      true,
    );
  });

  it("ungroups identity sessions when unbinding agent-home for a member", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Scout",
      playbook: "Look around.",
      role: "researcher",
    });
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const created = await sessionCreate(runtime, "t4", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String(
      (created.value as { sessionId?: string }).sessionId ?? "",
    );
    await unbindAgentHomeForMember(runtime, member!.id);
    expect(runtime.workspaces.get(home.workspaceId)).toBeUndefined();
    expect(runtime.sessionIdentities.get(sessionId)?.memberId).toBe(member!.id);
    expect(runtime.workspaces.workspaceIdOf(sessionId)).toBeUndefined();
    expect(
      runtime.workspaces.list(runtime.store.list()).archivedSessionIds,
    ).not.toContain(sessionId);
  });

  it("keeps boundMemberAppearance on workspace-changed after identity session create", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Looker",
      playbook: "Wear a face.",
      role: "worker",
      appearance: { shape: "gem", color: "coral" },
    });
    expect(member).toBeTruthy();
    const frames: Array<{ type: string; workspace?: { boundMemberAppearance?: { shape: string; color: string } } }> = [];
    runtime.bus.subscribeHost((_id, frame) => {
      if (frame.type === "host/workspace-changed") frames.push(frame);
    });
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const created = await sessionCreate(runtime, "t-look", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(created.ok).toBe(true);
    const afterCreate = frames.filter(
      (f) => f.type === "host/workspace-changed",
    );
    expect(afterCreate.length).toBeGreaterThanOrEqual(2);
    const last = afterCreate[afterCreate.length - 1]!;
    expect(last.workspace?.boundMemberAppearance?.shape).toBe("gem");
    expect(last.workspace?.boundMemberAppearance?.color).toBe("coral");
  });

  it("refuses cross-lane messaging between project and agent-home sessions", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(runtime.workspaces.defaultId(), "global", {
      name: "Peer",
      playbook: "Collaborate.",
      role: "worker",
    });
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const homeSession = await sessionCreate(runtime, "t5a", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(homeSession.ok).toBe(true);
    if (!homeSession.ok) return;
    const homeId = String(
      (homeSession.value as { sessionId?: string }).sessionId ?? "",
    );

    const other = path.join(runtime.productDir!, "coding-peer");
    mkdirSync(other, { recursive: true });
    const project = runtime.workspaces.create(other);
    const projectSession = await sessionCreate(runtime, "t5b", {
      workspaceId: project.workspace.workspaceId,
    });
    expect(projectSession.ok).toBe(true);
    if (!projectSession.ok) return;
    const projectId = String(
      (projectSession.value as { sessionId?: string }).sessionId ?? "",
    );

    expect(refuseCrossAgentHomeLane(runtime, projectId, homeId)).toMatch(
      /cannot message agent-home/,
    );
    expect(refuseCrossAgentHomeLane(runtime, homeId, projectId)).toMatch(
      /cannot message project/,
    );
    expect(refuseCrossAgentHomeLane(runtime, homeId, homeId)).toBeUndefined();
    expect(refuseCrossAgentHomeLane(runtime, projectId, projectId)).toBeUndefined();
  });
});
