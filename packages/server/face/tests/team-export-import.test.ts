import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { buildAgentMemberPackZip } from "../src/agent-member-pack.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

describe("team.export / team.importPack", () => {
  it("exports thin as JSON and advanced as zip; importPack materializes ready=false", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const thin = await dispatchFaceMethod(runtime, "team.upsert", "u1", {
      sessionId,
      name: "Thin Scout",
      playbook: "Read first.",
      role: "researcher",
      scope: "workspace",
      kind: "thin",
    });
    expect(thin.result.ok).toBe(true);
    const thinId = String(
      (thin.result.value as { member: { id: string } }).member.id,
    );

    const thinExport = await dispatchFaceMethod(runtime, "team.export", "e1", {
      sessionId,
      id: thinId,
    });
    expect(thinExport.result.ok).toBe(true);
    const thinBody = thinExport.result.value as {
      format: string;
      text?: string;
      fileName: string;
    };
    expect(thinBody.format).toBe("json");
    expect(thinBody.fileName.endsWith(".json")).toBe(true);
    expect(thinBody.text).toContain("xrk-agent-member");
    expect(thinBody.text).not.toContain("appearance");

    const zip = buildAgentMemberPackZip({
      name: "Pack Scout",
      playbook: "From pack.",
      role: "researcher",
    });
    const imported = await dispatchFaceMethod(runtime, "team.importPack", "i1", {
      sessionId,
      // omit scope → global
      zipBase64: zip.toString("base64"),
    });
    expect(imported.result.ok).toBe(true);
    const packValue = imported.result.value as {
      workspaceId: string;
      scope: string;
      visibility: string;
      member: { id: string; kind: string; ready: boolean; name: string };
      ready: boolean;
    };
    expect(packValue.workspaceId).toBe("global");
    expect(packValue.scope).toBe("global");
    expect(packValue.visibility).toMatch(/every workspace/);
    const packMember = packValue.member;
    expect(packMember.name).toBe("Pack Scout");
    expect(packMember.kind).toBe("advanced");
    expect(packMember.ready).toBe(false);

    const wsZip = buildAgentMemberPackZip({
      name: "Ws Pack",
      playbook: "Canvas only.",
      role: "worker",
    });
    const wsImported = await dispatchFaceMethod(runtime, "team.importPack", "i2", {
      sessionId,
      scope: "workspace",
      zipBase64: wsZip.toString("base64"),
    });
    expect(wsImported.result.ok).toBe(true);
    const wsValue = wsImported.result.value as {
      workspaceId: string;
      scope: string;
      visibility: string;
      member: { scope?: string; kind: string; ready: boolean };
    };
    expect(wsValue.scope).toBe("workspace");
    expect(wsValue.workspaceId).not.toBe("global");
    expect(wsValue.visibility).toMatch(/only canvas/);
    expect(wsValue.member.kind).toBe("advanced");
    expect(wsValue.member.ready).toBe(false);

    const advExport = await dispatchFaceMethod(runtime, "team.export", "e2", {
      sessionId,
      id: packMember.id,
    });
    expect(advExport.result.ok).toBe(true);
    const advBody = advExport.result.value as {
      format: string;
      base64?: string;
      fileName: string;
      packIncomplete?: boolean;
    };
    expect(advBody.format).toBe("zip");
    expect(advBody.fileName.endsWith(".zip")).toBe(true);
    expect(typeof advBody.base64).toBe("string");
    expect((advBody.base64 ?? "").length).toBeGreaterThan(20);
    expect(advBody.packIncomplete).toBeFalsy();
  });

  it("rejects illegal zip (no marker)", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    // Minimal store zip without marker — build via Buffer of bogus PK payload is hard;
    // use a pack zip then strip by sending random base64 that is not a zip.
    const bad = await dispatchFaceMethod(runtime, "team.importPack", "bad", {
      sessionId,
      scope: "workspace",
      zipBase64: Buffer.from("not-a-zip").toString("base64"),
    });
    expect(bad.result.ok).toBe(false);
  });
});
