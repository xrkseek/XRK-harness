/**
 * Reserved ws_im workspace + session list origin=im + empty hide on bridge.
 * ws_im is created on connect / first attach — not on Face boot.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { AgentHandle } from "@xrkseek/core-agent";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { IM_WORKSPACE_ID } from "../src/im-workspace.js";
import { ensureImWorkspace } from "../src/im-workspace-ensure.js";
import { bindImWorkspaceTools } from "../src/im-workspace-tools.js";
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

function runtimeAt(home: string) {
  return createFaceRuntime({
    store: createMemorySessionStore(),
    drain: drain(),
    workspaceRoot: home,
    // No productDir: avoid async workspaces.json persist racing afterEach rmSync.
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

afterEach(() => {
  delete process.env.XRK_IM_GATEWAY_URL;
  delete process.env.XRK_IM_GATEWAY_WS_URL;
});

describe("ws_im workspace", () => {
  it("does not create ws_im on Face boot", () => {
    const runtime = runtimeAt(process.cwd());
    expect(runtime.workspaces.get(IM_WORKSPACE_ID)).toBeUndefined();
  });

  it("ensures reserved workspace on session.create and marks origin=im", async () => {
    const runtime = runtimeAt(process.cwd());
    expect(runtime.workspaces.get(IM_WORKSPACE_ID)).toBeUndefined();

    const created = await dispatchFaceMethod(runtime, "session.create", "t1", {
      sessionId: "im-test-1",
      workspaceId: IM_WORKSPACE_ID,
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    expect(runtime.workspaces.get(IM_WORKSPACE_ID)?.title).toBe("IM");

    const listed = await dispatchFaceMethod(runtime, "session.list", "t2", {});
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const items = (
      listed.result.value as {
        items: Array<{
          sessionId: string;
          origin?: string;
          workspaceId?: string;
        }>;
      }
    ).items;
    const row = items.find((r) => r.sessionId === "im-test-1");
    expect(row?.origin).toBe("im");
    expect(row?.workspaceId).toBe(IM_WORKSPACE_ID);
  });

  it("hides empty ws_im on bridge; shows when sidecar env set", async () => {
    const runtime = runtimeAt(process.cwd());

    const hidden = await dispatchFaceMethod(runtime, "workspace.list", "w1", {});
    expect(hidden.result.ok).toBe(true);
    if (!hidden.result.ok) return;
    const emptyItems = (
      hidden.result.value as { items: Array<{ workspaceId: string }> }
    ).items;
    expect(emptyItems.some((w) => w.workspaceId === IM_WORKSPACE_ID)).toBe(
      false,
    );

    process.env.XRK_IM_GATEWAY_URL = "http://127.0.0.1:9999";
    const shown = await dispatchFaceMethod(runtime, "workspace.list", "w2", {});
    expect(shown.result.ok).toBe(true);
    if (!shown.result.ok) return;
    const wiredItems = (
      shown.result.value as { items: Array<{ workspaceId: string }> }
    ).items;
    expect(wiredItems.some((w) => w.workspaceId === IM_WORKSPACE_ID)).toBe(
      true,
    );
  });

  it("allows deleting ws_im (recreated on next connect)", async () => {
    const runtime = runtimeAt(process.cwd());
    await ensureImWorkspace(runtime);
    expect(runtime.workspaces.get(IM_WORKSPACE_ID)).toBeTruthy();
    const del = await dispatchFaceMethod(runtime, "workspace.delete", "d1", {
      workspaceId: IM_WORKSPACE_ID,
    });
    expect(del.result.ok).toBe(true);
    expect(runtime.workspaces.get(IM_WORKSPACE_ID)).toBeUndefined();
  });

  it("workspace_list / create / session_prompt bind on IM", async () => {
    const runtime = runtimeAt(process.cwd());
    await ensureImWorkspace(runtime);
    const tools = createToolRegistry();
    bindImWorkspaceTools(tools, { runtime, sessionId: "im-orch" });
    expect(tools.get("workspace_list")).toBeTruthy();
    expect(tools.get("workspace_create")).toBeTruthy();
    expect(tools.get("workspace_session_prompt")).toBeTruthy();
    const out = await tools.get("workspace_list")!.execute({});
    const body = JSON.parse(String(out.content)) as {
      items: Array<{ workspaceId: string; im?: boolean }>;
    };
    expect(body.items.some((w) => w.workspaceId === IM_WORKSPACE_ID)).toBe(
      true,
    );
    expect(body.items.find((w) => w.workspaceId === IM_WORKSPACE_ID)?.im).toBe(
      true,
    );
  });

  it("IM bindSessionAgent registers roster / session_query / workspace_list", async () => {
    const tools = createToolRegistry();
    const agent = {
      tools,
      admit() {
        return { admitId: "a", sessionId: "im", content: "", delivery: "queue" };
      },
      pendingAdmits() {
        return [];
      },
      abort() {},
      isBusy() {
        return false;
      },
      setApprovalHandler() {},
      async continueTurn() {
        return { text: "", events: [] };
      },
      async run() {
        return { text: "", events: [] };
      },
    } as AgentHandle;
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: process.cwd(),
      resolveAgent: async () => agent,
    });
    await ensureImWorkspace(runtime);
    const sid = runtime.ensureSession("im-bind");
    runtime.workspaces.attachSession(sid, IM_WORKSPACE_ID);
    await runtime.resolveAgent(sid);
    expect(tools.get("workspace_list")).toBeTruthy();
    expect(tools.get("workspace_create")).toBeTruthy();
    expect(tools.get("workspace_session_prompt")).toBeTruthy();
    expect(tools.get("team_list")).toBeTruthy();
    expect(tools.get("session_search")).toBeTruthy();
    expect(tools.get("ask_user")).toBeFalsy();
    expect(tools.get("presence_set")).toBeFalsy();
    expect(tools.get("thread_list")).toBeFalsy();
  });
});
