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
});
