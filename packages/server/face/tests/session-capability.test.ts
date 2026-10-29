import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createSessionCapabilityFragmentProvider,
  formatSessionCapability,
} from "../src/session-capability.js";
import {
  applySubagentSpawnPreamble,
  roleCapsHint,
} from "../src/agent-team-roles.js";
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

describe("session_capability", () => {
  it("formats permission × tool_surface for a parent session", async () => {
    const store = createMemorySessionStore();
    const root = await mkdtemp(path.join(tmpdir(), "xrk-cap-"));
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const codingRoot = path.join(root, "code-proj");
    const { workspace: codingWs } = runtime.workspaces.create(codingRoot);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: codingWs.workspaceId,
      agentPreset: "harness",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const text = formatSessionCapability(runtime, sessionId);
    expect(text).toMatch(/permission: .*path=/);
    expect(text).toMatch(/shell_confine=/);
    expect(text).toMatch(/permission_brief:/);
    expect(text).toMatch(/tool_surface: harness \(/);
    expect(text).toMatch(/surface_brief: kind=coding_parent/);
    expect(text).toMatch(/full tools \+ subagents/);
    expect(text).toMatch(/path_allowlist: \d+ objects/);

    const provider = createSessionCapabilityFragmentProvider(runtime);
    const frags = provider.produce({ sessionId });
    expect(frags).toHaveLength(1);
    expect(frags[0]!.text).toContain("<session_capability>");
    expect(frags[0]!.priority).toBe(9);
  });

  it("names orchestration tools on im / qichuang tool_surface", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-cap-orch-"));
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const xy = await dispatchFaceMethod(runtime, "session.create", "xy", {
      workspaceId: "ws_default",
    });
    expect(xy.result.ok).toBe(true);
    if (!xy.result.ok) return;
    const xyId = (xy.result.value as { sessionId: string }).sessionId;
    const xyText = formatSessionCapability(runtime, xyId);
    expect(xyText).toMatch(/tool_surface: qichuang \(full-access/);
    expect(xyText).toMatch(/settings\+team_\*/);
    expect(xyText).toMatch(/path=open/);
    expect(xyText).toMatch(/shell_confine=off/);
  });

  it("preamble includes inherited permission and weakened tool_surface", () => {
    expect(roleCapsHint("researcher")).toBe("web,read-fs");
    const out = applySubagentSpawnPreamble({
      prompt: "find facts",
      parentSessionId: "p1",
      childSessionId: "c1",
      mode: "one-shot",
      label: "scout",
      role: "researcher",
      inheritContext: false,
      cwd: "/ws",
      isolatedWorktree: false,
      permissionInherit: "workspace-write (path=allowlisted) · approval=ask",
      parentToolSurface: "harness",
    });
    expect(out).toContain(
      "permission: workspace-write (path=allowlisted) · approval=ask",
    );
    expect(out).toContain(
      "tool_surface: badge=harness · role=researcher · caps=web,read-fs",
    );
    expect(out).toContain("FINAL assistant message");
    expect(out).not.toContain("turn-start squad board");
  });

  it("preamble injects 公文包 (briefcase) while cwd stays parent workspace", () => {
    const packHome = "/home/u/.xrk/agent-rosters/packs/global/mem_hw";
    const out = applySubagentSpawnPreamble({
      prompt: "grade homework/hw1.md",
      parentSessionId: "p1",
      childSessionId: "c1",
      mode: "continuable",
      label: "作业生成员",
      role: "worker",
      inheritContext: false,
      cwd: "/proj/coding",
      isolatedWorktree: false,
      packHome,
      packMaterials: `${packHome}/workspace`,
      packInventoryLines: [
        "公文包 (briefcase): not workspace cwd — read/edit here or copy into workspace",
        `pack_home: ${packHome}`,
        `skills_dir: ${packHome}/skills`,
        "skills: 1 in skill catalog — load/search with the skill tool by name (not listed here); references/ under each skills/<id>/",
        `materials: ${packHome}/workspace · top=hw1.md`,
      ],
      memberId: "mem_hw",
      inject: "minimal",
    });
    expect(out).toMatch(/workspace: \/proj\/coding · same as the parent session/);
    expect(out).toMatch(/公文包 \(briefcase\)/);
    expect(out).toMatch(/pack_home: .*mem_hw/);
    expect(out).toMatch(/skills_dir:/);
    expect(out).toMatch(/skill tool/);
    expect(out).not.toMatch(/skill: lit @/);
    expect(out).toMatch(/member_id: mem_hw/);
  });

  it("formats kind=delegated for a tool-delegated child", async () => {
    const store = createMemorySessionStore();
    const root = await mkdtemp(path.join(tmpdir(), "xrk-cap-child-"));
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const codingRoot = path.join(root, "code-proj");
    const { workspace: codingWs } = runtime.workspaces.create(codingRoot);
    const parentCreated = await dispatchFaceMethod(runtime, "session.create", "p", {
      workspaceId: codingWs.workspaceId,
      agentPreset: "harness",
    });
    expect(parentCreated.result.ok).toBe(true);
    if (!parentCreated.result.ok) return;
    const parentId = (parentCreated.result.value as { sessionId: string }).sessionId;
    const childCreated = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: codingWs.workspaceId,
      agentPreset: "harness",
    });
    expect(childCreated.result.ok).toBe(true);
    if (!childCreated.result.ok) return;
    const childId = (childCreated.result.value as { sessionId: string }).sessionId;
    const scout = runtime.agentRoster.upsert(GLOBAL_ROSTER_ID, {
      id: "mem_scout",
      name: "scout",
      playbook: "Scout the repo.",
      role: "researcher",
      kind: "advanced",
      ready: true,
    });
    expect(scout?.id).toBe("mem_scout");
    const packHome = path.join(
      root,
      "agent-rosters",
      "packs",
      "global",
      "mem_scout",
    );
    const materials = path.join(packHome, "workspace");
    mkdirSync(materials, { recursive: true });
    const skillDir = path.join(packHome, "skills", "scout-notes");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: scout-notes\ndescription: notes\n---\n\n# Notes\n",
    );
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "one-shot",
      label: "scout",
      role: "researcher",
      memberId: "mem_scout",
    });
    // cwd stays the coding workspace — briefcase is injected separately.
    runtime.sessionCwds.set(childId, codingRoot);

    const text = formatSessionCapability(runtime, childId);
    expect(text).toContain("kind: delegated_child");
    expect(text).toContain(`parent: ${parentId}`);
    expect(text).toContain(`human_face: ${parentId}`);
    expect(text).toContain("member_id: mem_scout");
    expect(text).toContain("role: researcher");
    expect(text).toContain(`cwd: ${codingRoot}`);
    expect(text).toContain("公文包 (briefcase)");
    expect(text).toContain(`pack_home: ${packHome}`);
    expect(text).toContain(`skills_dir: ${path.join(packHome, "skills")}`);
    expect(text).toContain("skill tool");
    expect(text).toMatch(/skills: 1 in skill catalog/);
    expect(text).not.toContain(`skill: scout-notes @`);
    expect(text).toContain(`materials: ${materials}`);
    expect(text).not.toContain(`playbook: ${path.join(packHome, "playbook.md")}`);
    expect(text).toContain("ask→parent");
    expect(text).toContain("omitted:");
    expect(text).toContain("ask_user");
    expect(text).not.toMatch(/tool_surface: harness/);

    const parentText = formatSessionCapability(runtime, parentId);
    expect(parentText).toContain("child_gap:");
    expect(parentText).toContain("scout");

    // Middle layer: a delegated child that itself has a child still sees child_gap.
    const grandCreated = await dispatchFaceMethod(runtime, "session.create", "g", {
      workspaceId: codingWs.workspaceId,
      agentPreset: "harness",
    });
    expect(grandCreated.result.ok).toBe(true);
    if (!grandCreated.result.ok) return;
    const grandId = (grandCreated.result.value as { sessionId: string }).sessionId;
    runtime.subagents.attach({
      parentSessionId: childId,
      childSessionId: grandId,
      mode: "continuable",
      label: "leaf",
      role: "worker",
    });
    const midText = formatSessionCapability(runtime, childId);
    expect(midText).toContain("kind: delegated_child");
    expect(midText).toContain(`human_face: ${parentId}`);
    expect(midText).toContain("child_gap:");
    expect(midText).toContain("leaf");
  });
});
