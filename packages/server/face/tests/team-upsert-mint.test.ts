import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

describe("team.upsert mintHome", () => {
  it("does not mint 干员工作区 on ordinary roster create / nick edit", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const upserted = await dispatchFaceMethod(runtime, "team.upsert", "u1", {
      sessionId,
      name: "创业作业",
      playbook: "Ship the homework.",
      role: "worker",
      scope: "global",
      nickname: "老王",
    });
    expect(upserted.result.ok).toBe(true);
    const value = upserted.result.value as {
      member: { id: string; nickname?: string };
      homeWorkspaceId?: string;
    };
    expect(value.member.nickname).toBe("老王");
    expect(value.homeWorkspaceId).toBeUndefined();
    expect(
      runtime.workspaces.findAgentHomeByMember(value.member.id),
    ).toBeUndefined();
  });

  it("mints agent-home only when mintHome is true", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const upserted = await dispatchFaceMethod(runtime, "team.upsert", "u2", {
      sessionId,
      name: "课件匠",
      playbook: "Make slides.",
      role: "worker",
      scope: "global",
      mintHome: true,
    });
    expect(upserted.result.ok).toBe(true);
    const value = upserted.result.value as {
      member: { id: string };
      homeWorkspaceId?: string;
    };
    expect(value.homeWorkspaceId).toBeTruthy();
    const home = runtime.workspaces.get(value.homeWorkspaceId!);
    expect(home?.kind).toBe("agent-home");
    expect(home?.boundMemberId).toBe(value.member.id);
  });
});
