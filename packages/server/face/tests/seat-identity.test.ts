import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { mintAgentHomeForMember } from "../src/agent-home.js";
import { sessionCreate } from "../src/handlers/session.js";
import {
  createSeatIdentityFragmentProvider,
  formatNamedSeat,
  formatSeatIdentity,
} from "../src/seat-identity.js";
import {
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
} from "../src/agent-roster-store.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";

describe("seat-identity", () => {
  it("formats formal（nickname）", () => {
    expect(formatNamedSeat("经理", "阿葵")).toBe("经理（阿葵）");
    expect(formatNamedSeat("经理", "  ")).toBe("经理");
    expect(formatNamedSeat("老板", undefined)).toBe("老板");
  });

  it("project session: you=经理, speaker=老板", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "proj");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const created = await sessionCreate(runtime, "p1", {
      workspaceId: workspace.workspaceId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String((created.value as { sessionId: string }).sessionId);
    runtime.agentRoster.patchCatalogMeta(MANAGER_MEMBER_ID, {
      nickname: "阿经",
    });
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      bossNickname: "阿凯",
    });
    const text = formatSeatIdentity(runtime, sessionId);
    expect(text).toContain("you: 经理（阿经） (project)");
    expect(text).toContain("speaker: 老板（阿凯）");
    expect(text).toContain("report: 老板");
    expect(text).toContain("titles: 老板 / 经理 / 干员");
  });

  it("project session follows titleScheme × UI locale", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "proj-corp");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const created = await sessionCreate(runtime, "p-corp", {
      workspaceId: workspace.workspaceId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String((created.value as { sessionId: string }).sessionId);
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "corp",
      bossNickname: "阿凯",
    });
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "en",
    });
    const text = formatSeatIdentity(runtime, sessionId);
    expect(text).toContain("you: Lead (project)");
    expect(text).toContain("speaker: CEO（阿凯）");
    expect(text).toContain("titles: CEO / Lead / Specialist");
  });

  it("custom seat titles keep any language over UI locale", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "proj-custom");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const created = await sessionCreate(runtime, "p-custom", {
      workspaceId: workspace.workspaceId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String((created.value as { sessionId: string }).sessionId);
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "ja",
    });
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "office",
      titleBoss: "老板",
      titleManager: "经理",
      titleAgent: "干员",
    });
    const text = formatSeatIdentity(runtime, sessionId);
    expect(text).toContain("you: 经理 (project)");
    expect(text).toContain("speaker: 老板");
    expect(text).toContain("titles: 老板 / 经理 / 干员");
  });

  it("xiangyang session: you=向日葵（xrkseek）, nickname locked", async () => {
    const runtime = createBareFaceRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const created = await sessionCreate(runtime, "xy1", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = String((created.value as { sessionId: string }).sessionId);
    const text = formatSeatIdentity(runtime, sessionId);
    expect(text).toContain("you: 向日葵（xrkseek） (xiangyang)");
    expect(text).toContain("nickname: locked");
    expect(runtime.agentRoster.get("global", SUNFLOWER_MEMBER_ID)?.name).toBe(
      "向日葵",
    );
  });

  it("agent-home identity + subagent seats", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "施工员自定义",
        playbook: "Ship.",
        role: "worker",
        nickname: "小工",
      },
    );
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const created = await sessionCreate(runtime, "h1", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const homeId = String((created.value as { sessionId: string }).sessionId);
    expect(formatSeatIdentity(runtime, homeId)).toContain(
      "you: 施工员自定义（小工） (agent-home)",
    );

    const child = await sessionCreate(runtime, "c1", {
      workspaceId: home.workspaceId,
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    const childId = String((child.value as { sessionId: string }).sessionId);
    runtime.subagents.attach({
      parentSessionId: homeId,
      childSessionId: childId,
      mode: "one-shot",
      label: "helper",
      memberId: member!.id,
    });
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const childText = formatSeatIdentity(runtime, childId);
    expect(childText).toContain(
      "you: 施工员自定义（小工） (subagent · parent_surface=identity)",
    );
    expect(childText).toContain("report: 施工员自定义（小工）");
    expect(childText).toMatch(/human_face: 老板 \(/);
    expect(childText).toContain("channels: UI→[老板]");
    expect(childText).toContain("parent_tool→[施工员自定义（小工）]");
    expect(childText).not.toMatch(/speaker: 老板/);

    const frags = createSeatIdentityFragmentProvider(runtime).produce({
      sessionId: homeId,
    });
    expect(frags).toHaveLength(1);
    expect(frags[0]!.text).toContain("<seat_identity>");
    expect(frags[0]!.priority).toBe(8.1);
  });

  it("project→child: report is 经理, channels distinguish 老板 UI vs parent tool", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "proj-child");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const parentCreated = await sessionCreate(runtime, "p-mgr", {
      workspaceId: workspace.workspaceId,
    });
    expect(parentCreated.ok).toBe(true);
    if (!parentCreated.ok) return;
    const parentId = String(
      (parentCreated.value as { sessionId: string }).sessionId,
    );
    const childCreated = await sessionCreate(runtime, "c-agent", {
      workspaceId: workspace.workspaceId,
    });
    expect(childCreated.ok).toBe(true);
    if (!childCreated.ok) return;
    const childId = String(
      (childCreated.value as { sessionId: string }).sessionId,
    );
    runtime.agentRoster.patchCatalogMeta(MANAGER_MEMBER_ID, {
      nickname: "阿经",
    });
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      bossNickname: "阿凯",
    });
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "one-shot",
      label: "施工员",
    });
    const text = formatSeatIdentity(runtime, childId);
    expect(text).toContain("report: 经理（阿经）");
    expect(text).toContain("parent_surface=manager");
    expect(text).toContain("human_face: 老板（阿凯）");
    expect(text).toContain("channels: UI→[老板（阿凯）]");
    expect(text).toContain("parent_tool→[经理（阿经）]");
    expect(text).not.toMatch(/speaker: 老板/);
  });

  it("child seat_identity uses custom titleBoss/Manager labels", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "proj-custom-child");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const parentCreated = await sessionCreate(runtime, "p-custom-c", {
      workspaceId: workspace.workspaceId,
    });
    expect(parentCreated.ok).toBe(true);
    if (!parentCreated.ok) return;
    const parentId = String(
      (parentCreated.value as { sessionId: string }).sessionId,
    );
    const childCreated = await sessionCreate(runtime, "c-custom", {
      workspaceId: workspace.workspaceId,
    });
    expect(childCreated.ok).toBe(true);
    if (!childCreated.ok) return;
    const childId = String(
      (childCreated.value as { sessionId: string }).sessionId,
    );
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "office",
      titleBoss: "主公",
      titleManager: "军师",
      titleAgent: "先锋",
      bossNickname: "阿凯",
    });
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "one-shot",
      label: "先锋甲",
    });
    const text = formatSeatIdentity(runtime, childId);
    expect(text).toContain("report: 军师");
    expect(text).toContain("human_face: 主公（阿凯）");
    expect(text).toContain("channels: UI→[主公（阿凯）]");
    expect(text).toContain("parent_tool→[军师]");
    expect(text).toContain("titles: 主公 / 军师 / 先锋");
  });

  it("rejects sunflower nickname patch", () => {
    const runtime = createBareFaceRuntime();
    expect(
      runtime.agentRoster.patchCatalogMeta(SUNFLOWER_MEMBER_ID, {
        nickname: "花",
      }),
    ).toBeUndefined();
  });
});

