import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createServerAgentFactory } from "@xrkseek/preset-server";
import { resolveToolPreset } from "@xrkseek/server-face";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager, type AgentFactory } from "../src/index.js";

describe("host session agentPreset → tool composition", () => {
  it("session agentPreset harness gets web_search even when Host --preset is minimal", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-host-preset-"));
    const manager = createHostManager();
    const config = loadHostConfig({
      env: { XRK_HOST: "127.0.0.1", XRK_PORT: "0" },
      patch: { workspaceRoot: dir, preset: "minimal" },
    });

    const seen: { agentPreset?: string; tools: string[] }[] = [];

    // Same dispatch rule as CLI `factoryForPreset`: session badge wins.
    const factory: AgentFactory = async (input) => {
      const preset = resolveToolPreset(input.agentPreset, "minimal");
      const agent =
        preset === "minimal"
          ? await createMinimalComposition({
              workspaceRoot: input.workspaceRoot,
              sessionStore: input.store,
              sessionId: input.sessionId,
              assemble: true,
              plugins: input.plugins,
              llm: createReplayAdapter([{ content: "ok" }]),
            }).createAgent()
          : await createServerAgentFactory({
              workspaceRoot: input.workspaceRoot,
              llm: createReplayAdapter([{ content: "ok" }]),
            })(input);
      seen.push({
        ...(input.agentPreset !== undefined
          ? { agentPreset: input.agentPreset }
          : {}),
        tools: agent.tools.list().map((t) => t.name),
      });
      return agent;
    };

    const instance = await manager.spawn(config, factory);
    const port = instance.health().port!;

    const createRes = await fetch(`http://127.0.0.1:${port}/api/session.create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rpcId: "c1",
        payload: { agentPreset: "harness" },
      }),
    });
    expect(createRes.status).toBe(200);
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
          content: [{ type: "text", text: "ping" }],
        },
      }),
    });

    await viWaitUntil(() => seen.length > 0);
    expect(seen[0]?.agentPreset).toBe("harness");
    expect(seen[0]?.tools).toContain("web_search");
    expect(seen[0]?.tools).toContain("bash");

    await manager.stopAll();
  });
});

async function viWaitUntil(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitUntil timeout");
}
