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

  it("team_save refuses to overwrite an advanced pack member", async () => {
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
      name: "Hijack",
      playbook: "should fail",
    });
    expect(save.isError).toBe(true);
    expect(String(save.content)).toMatch(/refuse|advanced/i);
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
});
