import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createServerAgentFactory } from "@xrkseek/preset-server";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";

describe("host session cwd wiring", () => {
  it("host spawn passes per-session cwd into agent factory", async () => {
    const hostRoot = await mkdtemp(path.join(tmpdir(), "xrk-host-root-"));
    const projectRoot = await mkdtemp(path.join(tmpdir(), "xrk-project-"));
    await mkdir(path.join(projectRoot, ".xrk"), { recursive: true });

    const manager = createHostManager();
    const config = loadHostConfig({
      env: { XRK_HOST: "127.0.0.1", XRK_PORT: "0" },
      patch: { workspaceRoot: hostRoot, preset: "minimal" },
    });
    const roots: string[] = [];
    const instance = await manager.spawn(config, async (input) => {
      roots.push(input.workspaceRoot);
      const factory = createServerAgentFactory({
        workspaceRoot: hostRoot,
        llm: createReplayAdapter([{ content: "ok" }]),
      });
      return factory(input);
    });

    const port = instance.health().port!;
    const wsRes = await fetch(`http://127.0.0.1:${port}/api/workspace.create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rpcId: "w1",
        payload: { path: projectRoot },
      }),
    });
    const wsBody = (await wsRes.json()) as {
      result: { ok: boolean; value?: { workspace: { workspaceId: string } } };
    };
    expect(wsBody.result.ok).toBe(true);
    const workspaceId = wsBody.result.value!.workspace.workspaceId;

    const createRes = await fetch(`http://127.0.0.1:${port}/api/session.create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rpcId: "c1",
        payload: { workspaceId },
      }),
    });
    const createBody = (await createRes.json()) as {
      result: { ok: boolean; value?: { sessionId: string } };
    };
    expect(createBody.result.ok).toBe(true);
    const sessionId = createBody.result.value!.sessionId;

    await fetch(`http://127.0.0.1:${port}/api/session.prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rpcId: "p1",
        payload: {
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: "hi" }],
        },
      }),
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(roots).toContain(path.resolve(projectRoot));

    await instance.stop();
  });
});
