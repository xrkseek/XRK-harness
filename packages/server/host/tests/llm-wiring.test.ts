import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { resolveLlmFromEnv } from "@xrkseek/llm-registry";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";

describe("host llm wiring", () => {
  it("passes resolveLlm into the agent factory after Face starts", async () => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: { XRK_HOST: "127.0.0.1", XRK_PORT: "0" },
      patch: { workspaceRoot: process.cwd(), preset: "minimal" },
    });
    let sawResolveLlm = false;
    const instance = await manager.spawn(config, async (input) => {
      if (input.resolveLlm) sawResolveLlm = true;
      const llm =
        input.resolveLlm?.(input.sessionId) ??
        resolveLlmFromEnv(process.env)?.adapter ??
        createReplayAdapter([{ content: "replay-fallback" }]);
      const composition = createMinimalComposition({
        workspaceRoot: input.workspaceRoot,
        sessionStore: input.store,
        sessionId: input.sessionId,
        plugins: input.plugins,
        llm,
        assemble: true,
      });
      return composition.createAgent();
    });

    const sessionId = instance.store.create().id;
    const port = instance.health().port!;
    await fetch(`http://127.0.0.1:${port}/api/session.prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rpcId: "p0",
        payload: {
          sessionId,
          mode: "queue",
          content: [{ type: "text", text: "ping" }],
        },
      }),
    });
    expect(sawResolveLlm).toBe(true);
    await manager.stopAll();
    void instance;
  });

  it("resolveLlm yields deepseek adapter when workspace settings + credentials exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-host-llm-"));
    const xrkDir = path.join(dir, ".xrk");
    await mkdir(xrkDir, { recursive: true });
    await writeFile(
      path.join(xrkDir, "settings.yaml"),
      [
        "llm-deepseek:",
        "  baseURL: https://api.deepseek.com",
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-flash",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(xrkDir, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-host-wiring\n",
      "utf8",
    );

    const manager = createHostManager();
    const config = loadHostConfig({
      env: { XRK_HOST: "127.0.0.1", XRK_PORT: "0" },
      patch: { workspaceRoot: dir, preset: "minimal" },
    });

    let capturedAdapterId: string | undefined;
    const instance = await manager.spawn(config, async (input) => {
      const llm =
        input.resolveLlm?.(input.sessionId) ??
        createReplayAdapter([{ content: "replay-fallback" }]);
      capturedAdapterId = llm.id;
      const composition = createMinimalComposition({
        workspaceRoot: input.workspaceRoot,
        sessionStore: input.store,
        sessionId: input.sessionId,
        plugins: input.plugins,
        llm,
        assemble: true,
      });
      return composition.createAgent();
    });

    const store = instance.store;
    const sessionId = store.create().id;
    const port = instance.health().port!;
    const promptRes = await fetch(`http://127.0.0.1:${port}/api/session.prompt`, {
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
    expect(promptRes.status).toBe(200);

    expect(capturedAdapterId).toMatch(/^session:/);
    await manager.stopAll();
  });
});
