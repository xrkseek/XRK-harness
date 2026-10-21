import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { bindAgentRosterTools } from "../src/agent-roster-tools.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";

describe("bindAgentRosterTools", () => {
  it("listOnly registers team_list without team_save", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId, listOnly: true });
    expect(tools.get("team_list")).toBeTruthy();
    expect(tools.get("team_save")).toBeUndefined();

    const full = createToolRegistry();
    bindAgentRosterTools(full, { runtime, sessionId });
    expect(full.get("team_list")).toBeTruthy();
    expect(full.get("team_save")).toBeTruthy();
    expect(full.get("team_import")).toBeTruthy();
    expect(full.get("team_ready")).toBeTruthy();
    expect(full.get("team_export")).toBeTruthy();
    expect(full.get("team_remove")).toBeTruthy();
  });

  it("team_import mints a member without appearance", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });
    const card = JSON.stringify({
      kind: "xrk-agent-member",
      name: "Shared Scout",
      playbook: "Read first. Cite paths.",
      role: "researcher",
      appearance: { shape: "star", color: "coral" },
    });
    const result = await tools.get("team_import")!.execute({ card });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(String(result.content)) as {
      member: { name: string; appearance?: { shape?: string } };
    };
    expect(body.member.name).toBe("Shared Scout");
    expect(body.member.appearance?.shape ?? "blob").toBe("blob");
  });

  it("team_import pack= installs advanced ready=false; team_ready unlocks", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { buildAgentMemberPackZip } = await import("../src/agent-member-pack.js");

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const cwd = mkdtempSync(path.join(tmpdir(), "xrk-team-pack-"));
    runtime.sessionCwds.set(sessionId, cwd);
    const zipPath = path.join(cwd, "scout.zip");
    writeFileSync(
      zipPath,
      buildAgentMemberPackZip({
        name: "Pack Scout",
        playbook: "From pack.",
        role: "researcher",
      }),
    );

    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });
    const result = await tools.get("team_import")!.execute({ pack: "scout.zip" });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(String(result.content)) as {
      source: string;
      member: { name: string; kind?: string; ready?: boolean; id: string };
      next?: string;
    };
    expect(body.source).toBe("pack");
    expect(body.member.name).toBe("Pack Scout");
    expect(body.member.kind).toBe("advanced");
    expect(body.member.ready).toBe(false);
    expect(body.next).toContain("team_ready");
    // Pack omit-scope → global (visible from any workspace).
    const listed = JSON.parse(
      String((await tools.get("team_list")!.execute({})).content),
    ) as { members: Array<{ id: string; scope?: string }> };
    expect(listed.members.find((m) => m.id === body.member.id)?.scope).toBe(
      "global",
    );

    const ready = await tools.get("team_ready")!.execute({ id: body.member.id });
    expect(ready.isError).toBeFalsy();
    const readyBody = JSON.parse(String(ready.content)) as {
      member: { ready?: boolean };
    };
    expect(readyBody.member.ready).toBe(true);
  });

  it("team_save revises advanced playbook in place (keeps kind); team_self for child; team_remove uninstalls", async () => {
    const { buildAgentMemberPackZip } = await import("../src/agent-member-pack.js");
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const zip = buildAgentMemberPackZip({
      name: "Guard",
      playbook: "Stay advanced.",
      role: "worker",
    });
    const imported = await dispatchFaceMethod(runtime, "team.importPack", "i", {
      sessionId,
      zipBase64: zip.toString("base64"),
    });
    expect(imported.result.ok).toBe(true);
    const id = String(
      (imported.result.value as { member: { id: string } }).member.id,
    );
    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });
    const save = await tools.get("team_save")!.execute({
      id,
      name: "Guard v2",
      playbook: "Improved playbook.",
      scope: "global",
    });
    expect(save.isError).toBeFalsy();
    const saved = JSON.parse(String(save.content)) as {
      kind: string;
      member: { name: string; playbook: string; kind?: string };
    };
    expect(saved.kind).toBe("advanced");
    expect(saved.member.name).toBe("Guard v2");
    expect(saved.member.playbook).toContain("Improved");
    expect(saved.member.kind).toBe("advanced");

    const childTools = createToolRegistry();
    bindAgentRosterTools(childTools, {
      runtime,
      sessionId,
      listOnly: true,
      selfMemberId: id,
    });
    expect(childTools.get("team_save")).toBeUndefined();
    expect(childTools.get("team_self")).toBeTruthy();
    const self = await childTools.get("team_self")!.execute({
      playbook: "Child-revised playbook.",
      brief: "Self note",
      inject: "subagent",
      tools: { mode: "deny", names: ["bash"] },
    });
    expect(self.isError).toBeFalsy();
    const selfBody = JSON.parse(String(self.content)) as {
      member: {
        playbook: string;
        brief: string;
        inject?: string;
        tools?: { mode: string; names: string[] };
      };
    };
    expect(selfBody.member.playbook).toContain("Child-revised");
    expect(selfBody.member.brief).toBe("Self note");
    expect(selfBody.member.inject).toBe("subagent");
    expect(selfBody.member.tools).toEqual({ mode: "deny", names: ["bash"] });

    const cwd = (await import("node:os")).tmpdir();
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const exportCwd = mkdtempSync(join(cwd, "xrk-team-export-"));
    runtime.sessionCwds.set(sessionId, exportCwd);
    const exported = await tools.get("team_export")!.execute({ id });
    expect(exported.isError).toBeFalsy();
    const expBody = JSON.parse(String(exported.content)) as {
      format: string;
      path: string;
      fileName: string;
    };
    expect(expBody.format).toBe("zip");
    expect(expBody.fileName.endsWith(".zip")).toBe(true);
    expect(expBody.path).toContain(expBody.fileName);

    const removed = await tools.get("team_remove")!.execute({
      id,
      scope: "global",
    });
    expect(removed.isError).toBeFalsy();
    const listed = JSON.parse(
      String((await tools.get("team_list")!.execute({})).content),
    ) as { members: Array<{ id: string }> };
    expect(listed.members.find((m) => m.id === id)).toBeUndefined();
  });

  it("team_save omit playbook does not overwrite a fresher on-disk playbook.md", async () => {
    const {
      buildAgentMemberPackZip,
      readMemberPackPlaybook,
      resolveMemberPackHome,
    } = await import("../src/agent-member-pack.js");
    const { writeFileSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { GLOBAL_ROSTER_ID } = await import("../src/agent-roster-store.js");
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const zip = buildAgentMemberPackZip({
      name: "Lit Scout",
      playbook: "skills (41个) — old roster copy",
      role: "researcher",
    });
    const imported = await dispatchFaceMethod(runtime, "team.importPack", "i", {
      sessionId,
      zipBase64: zip.toString("base64"),
    });
    expect(imported.result.ok).toBe(true);
    const id = String(
      (imported.result.value as { member: { id: string } }).member.id,
    );
    const packOpts = {
      rosterWorkspaceId: GLOBAL_ROSTER_ID,
      memberId: id,
      productHome: runtime.agentRoster.home,
    };
    const diskPath = path.join(resolveMemberPackHome(packOpts)!, "playbook.md");
    const fresher =
      "skills (42个) — §7.1 §10\nLive disk edit after import.\n";
    writeFileSync(diskPath, fresher, "utf8");

    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });
    const save = await tools.get("team_save")!.execute({
      id,
      brief: "Duty line only — no playbook field",
      scope: "global",
    });
    expect(save.isError).toBeFalsy();
    expect(readFileSync(diskPath, "utf8")).toContain("skills (42个)");
    expect(readFileSync(diskPath, "utf8")).not.toContain("41个");
    const body = JSON.parse(String(save.content)) as {
      member: { playbook: string; brief?: string };
    };
    expect(body.member.playbook).toContain("42个");
    expect(body.member.brief).toBe("Duty line only — no playbook field");
    expect(readMemberPackPlaybook(packOpts)).toContain("§7.1");

    // team_list omits full playbook in public fields; heal lands on the store.
    await tools.get("team_list")!.execute({});
    const healed = runtime.agentRoster.get(
      (await import("../src/canvas-tools.js")).canvasWorkspaceIdForSession(
        runtime,
        sessionId,
      ),
      id,
    );
    expect(healed?.playbook).toContain("42个");
  });

  it("team_list resurfaces envPrep for UI-imported not-ready packs", async () => {
    const { buildAgentMemberPackZip } = await import("../src/agent-member-pack.js");
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const zip = buildAgentMemberPackZip(
      { name: "Env Scout", playbook: "Cite paths.", role: "researcher" },
      { envPrep: "Install ripgrep if missing.\n" },
    );
    const imported = await dispatchFaceMethod(runtime, "team.importPack", "i1", {
      sessionId,
      scope: "workspace",
      zipBase64: zip.toString("base64"),
    });
    expect(imported.result.ok).toBe(true);
    const memberId = String(
      (imported.result.value as { member: { id: string } }).member.id,
    );

    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });
    const listed = await tools.get("team_list")!.execute({});
    expect(listed.isError).toBeFalsy();
    const body = JSON.parse(String(listed.content)) as {
      members: Array<{
        id: string;
        ready?: boolean;
        envPrep?: string;
        next?: string;
      }>;
    };
    const row = body.members.find((m) => m.id === memberId);
    expect(row?.ready).toBe(false);
    expect(row?.envPrep).toContain("ripgrep");
    expect(row?.next).toContain("team_ready");
  });

  it("team_import pack=attachment:sha256 imports from a chat file upload", async () => {
    const { createMemoryAttachmentStore } = await import("@xrkseek/attachment");
    const { buildAgentMemberPackZip } = await import("../src/agent-member-pack.js");

    const store = createMemorySessionStore();
    const attachments = createMemoryAttachmentStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      attachments,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const zip = buildAgentMemberPackZip({
      name: "Attach Scout",
      playbook: "From attachment.",
      role: "researcher",
    });
    const ref = await attachments.saveFile({
      data: zip,
      name: "scout.zip",
      mediaType: "application/zip",
    });

    // Reference the attachment on the session (same as a user upload).
    store.append(sessionId, {
      type: "user/message",
      ts: Date.now(),
      turnId: "t-pack",
      content: [
        { type: "text", text: "请导入这个干员包并准备就绪" },
        {
          type: "file",
          attachment: {
            attachmentId: ref.attachmentId,
            name: ref.name,
            bytes: ref.bytes,
            ...(ref.mediaType ? { mediaType: ref.mediaType } : {}),
          },
        },
      ],
    });

    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });
    const result = await tools.get("team_import")!.execute({
      pack: `attachment:${ref.attachmentId}`,
    });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(String(result.content)) as {
      member: { name: string; kind?: string; ready?: boolean };
      source: string;
    };
    expect(body.source).toBe("pack");
    expect(body.member.name).toBe("Attach Scout");
    expect(body.member.kind).toBe("advanced");
    expect(body.member.ready).toBe(false);
  });

  it("team_import pack scope=workspace is canvas-only; other canvas gets findHome hint", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { buildAgentMemberPackZip } = await import("../src/agent-member-pack.js");

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const a = await dispatchFaceMethod(runtime, "session.create", "a", {});
    if (!a.result.ok) throw new Error("create a");
    const sessionA = (a.result.value as { sessionId: string }).sessionId;
    const cwd = mkdtempSync(path.join(tmpdir(), "xrk-team-ws-pack-"));
    runtime.sessionCwds.set(sessionA, cwd);
    writeFileSync(
      path.join(cwd, "local.zip"),
      buildAgentMemberPackZip({
        name: "Local Only",
        playbook: "Workspace pack.",
        role: "worker",
      }),
    );

    const toolsA = createToolRegistry();
    bindAgentRosterTools(toolsA, { runtime, sessionId: sessionA });
    const imported = await toolsA.get("team_import")!.execute({
      pack: "local.zip",
      scope: "workspace",
    });
    expect(imported.isError).toBeFalsy();
    const body = JSON.parse(String(imported.content)) as {
      scope: string;
      visibility: string;
      member: { id: string };
      workspaceId: string;
    };
    expect(body.scope).toBe("workspace");
    expect(body.visibility).toMatch(/only canvas/);
    expect(body.workspaceId).not.toBe("global");

    const listedA = JSON.parse(
      String((await toolsA.get("team_list")!.execute({})).content),
    ) as { members: Array<{ id: string; scope?: string; visibility?: string }> };
    const rowA = listedA.members.find((m) => m.id === body.member.id);
    expect(rowA?.scope).toBe("workspace");
    expect(rowA?.visibility).toMatch(/only canvas/);

    const extra = await dispatchFaceMethod(runtime, "workspace.create", "w", {
      path: mkdtempSync(path.join(tmpdir(), "xrk-ws-b-")),
      title: "Other",
    });
    expect(extra.result.ok).toBe(true);
    const wsB = (
      extra.result.value as { workspace: { workspaceId: string } }
    ).workspace.workspaceId;
    const b = await dispatchFaceMethod(runtime, "session.create", "b", {
      workspaceId: wsB,
    });
    if (!b.result.ok) throw new Error("create b");
    const sessionB = (b.result.value as { sessionId: string }).sessionId;

    const toolsB = createToolRegistry();
    bindAgentRosterTools(toolsB, { runtime, sessionId: sessionB });
    const listedB = JSON.parse(
      String((await toolsB.get("team_list")!.execute({})).content),
    ) as { members: Array<{ id: string }> };
    expect(listedB.members.find((m) => m.id === body.member.id)).toBeUndefined();

    const ready = await toolsB.get("team_ready")!.execute({ id: body.member.id });
    expect(ready.isError).toBe(true);
    expect(String(ready.content)).toMatch(/workspace-scoped/);
  });

  it("team_save kind=advanced mints pack with skills/files; team_import only installs; export works", async () => {
    const { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } =
      await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const {
      resolveMemberPackHome,
      resolveMemberPackMaterialsDir,
    } = await import("../src/agent-member-pack.js");
    const { GLOBAL_ROSTER_ID } = await import("../src/agent-roster-store.js");

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const cwd = mkdtempSync(path.join(tmpdir(), "xrk-mint-adv-"));
    runtime.sessionCwds.set(sessionId, cwd);
    const skillDir = path.join(cwd, ".agents", "skills", "lit-search");
    mkdirSync(path.join(skillDir, "references"), { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: lit-search\ndescription: lit\n---\n# Lit\nSee references/sources.md\n",
    );
    writeFileSync(
      path.join(skillDir, "references", "sources.md"),
      "# Sources\n- DOI list\n",
    );
    const projectDir = path.join(cwd, "lit-kit");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "queries.txt"), "transformer survey\n");

    const tools = createToolRegistry();
    bindAgentRosterTools(tools, { runtime, sessionId });

    const legacy = await tools.get("team_import")!.execute({
      from_session: true,
      name: "x",
      playbook: "y",
    });
    expect(legacy.isError).toBe(true);
    expect(String(legacy.content)).toMatch(/team_save/);

    const minted = await tools.get("team_save")!.execute({
      kind: "advanced",
      name: "文献助研",
      playbook: "Search papers; use lit-search skill; cite DOI.",
      brief: "Literature scout",
      role: "researcher",
      env_prep: "Install: pip install scholarly\nAPI: set SEMANTIC_SCHOLAR_KEY",
      skills: [".agents/skills/lit-search"],
      files: ["./lit-kit"],
    });
    expect(minted.isError).toBeFalsy();
    const body = JSON.parse(String(minted.content)) as {
      source: string;
      scope: string;
      kind: string;
      member: { id: string; kind?: string; ready?: boolean; name: string };
      skillNames: string[];
      packDir: string;
      envPrep?: string;
      ready: boolean;
      shareHint?: string;
      pathHint?: string;
    };
    expect(body.source).toBe("team_save");
    expect(body.kind).toBe("advanced");
    expect(body.scope).toBe("global");
    expect(body.member.name).toBe("文献助研");
    expect(body.member.kind).toBe("advanced");
    expect(body.member.ready).toBe(false);
    expect(body.ready).toBe(false);
    expect(body.skillNames).toContain("lit-search");
    expect(body.envPrep).toMatch(/scholarly/);
    expect(readFileSync(path.join(body.packDir, "playbook.md"), "utf8")).toMatch(
      /Paths \(portable\)/,
    );
    expect(body.pathHint).toMatch(/relative/i);
    expect(
      existsSync(
        path.join(body.packDir, "skills", "lit-search", "references", "sources.md"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        path.join(body.packDir, "workspace", "lit-kit", "queries.txt"),
        "utf8",
      ),
    ).toMatch(/transformer/);
    expect(
      resolveMemberPackHome({
        rosterWorkspaceId: GLOBAL_ROSTER_ID,
        memberId: body.member.id,
        productHome: runtime.agentRoster.home,
      }),
    ).toBe(body.packDir);
    expect(
      resolveMemberPackMaterialsDir({
        rosterWorkspaceId: GLOBAL_ROSTER_ID,
        memberId: body.member.id,
        productHome: runtime.agentRoster.home,
      }),
    ).toBe(path.join(body.packDir, "workspace"));
    expect(body.pathHint).toMatch(/公文包 \(briefcase\)|briefcase/i);

    const listed = JSON.parse(
      String((await tools.get("team_list")!.execute({})).content),
    ) as { members: Array<{ id: string; ready?: boolean; envPrep?: string }> };
    const row = listed.members.find((m) => m.id === body.member.id);
    expect(row?.ready).toBe(false);
    expect(row?.envPrep).toMatch(/SEMANTIC_SCHOLAR/);

    const ready = await tools.get("team_ready")!.execute({ id: body.member.id });
    expect(ready.isError).toBeFalsy();
    expect(
      (JSON.parse(String(ready.content)) as { member: { ready?: boolean } }).member.ready,
    ).toBe(true);

    const exported = await dispatchFaceMethod(runtime, "team.export", "e", {
      sessionId,
      id: body.member.id,
    });
    expect(exported.result.ok).toBe(true);
    const exp = exported.result.value as { format: string; fileName: string };
    expect(exp.format).toBe("zip");
    expect(exp.fileName.endsWith(".zip")).toBe(true);

    const catalogExport = await dispatchFaceMethod(runtime, "team.export", "e-seed", {
      sessionId,
      id: "mem_seed_researcher",
    });
    expect(catalogExport.result.ok).toBe(false);
    expect(
      String(
        (catalogExport.result as { error?: { message?: string } }).error?.message ?? "",
      ),
    ).toMatch(/cannot be exported|catalog/i);

    const thin = await tools.get("team_save")!.execute({
      name: "Thin Note",
      playbook: "Short thin member.",
      scope: "workspace",
    });
    expect(thin.isError).toBeFalsy();
    const thinId = (JSON.parse(String(thin.content)) as { member: { id: string } }).member
      .id;
    const thinExport = await dispatchFaceMethod(runtime, "team.export", "e2", {
      sessionId,
      id: thinId,
    });
    expect(thinExport.result.ok).toBe(true);
    const thinExp = thinExport.result.value as { format: string; fileName: string };
    expect(thinExp.format).toBe("json");
    expect(thinExp.fileName.endsWith(".json")).toBe(true);
  });
});
