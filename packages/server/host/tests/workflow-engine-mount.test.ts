import { describe, expect, it, vi } from "vitest";
import type { FaceRuntime } from "@xrkseek/server-face";
import {
  createFaceWorkflowCreateAgent,
  mountHostIsolatingWorkflowEngine,
} from "../src/workflow-engine-mount.js";

describe("Host Isolating workflow mount", () => {
  it("exposes Isolating provider with Face createAgent bridge", async () => {
    const runtime = {
      store: {},
      drain: { isActive: () => false },
    } as unknown as FaceRuntime;
    const mount = mountHostIsolatingWorkflowEngine(runtime);
    expect(mount.provider).toBe("isolating");
    expect(mount.createAgentBridged).toBe(true);
    expect(typeof mount.toolsBridged).toBe("boolean");
    expect(mount.engine).toBeTruthy();

    const run = mount.engine.start({
      script: `
        try {
          const a = await agent({ label: 'bridged', prompt: 'ping' });
          return { ok: true, a };
        } catch (e) {
          return { ok: false, msg: String(e && e.message ? e.message : e) };
        }
      `,
      meta: { name: "host-iso", description: "Host default Isolating" },
      parent: { session: { id: "parent-1" } } as never,
    });
    const result = await run.result;
    expect(result.stopReason).toBe("completed");
    expect(result.agentsStarted).toBe(1);
    // Stub FaceRuntime has no session handlers — bridge error is visible to the script.
    expect(result.value).toMatchObject({ ok: false });
    await run.dispose();
    await mount.dispose();
  });

  it("createFaceWorkflowCreateAgent requires parent.session.id", async () => {
    const runtime = {
      store: {},
      drain: { isActive: () => false },
    } as unknown as FaceRuntime;
    const createAgent = createFaceWorkflowCreateAgent(runtime);
    await expect(
      createAgent(
        { parent: {} as never, script: "", meta: { name: "x", description: "y" } },
        { label: "l", prompt: "p" },
      ),
    ).rejects.toThrow(/parent\.session\.id/);
  });
});
