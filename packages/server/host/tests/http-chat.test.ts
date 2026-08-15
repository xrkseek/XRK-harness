import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";

describe("host http chat", () => {
  it("serves health + authenticated chat with replay", async () => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        XRK_API_KEY: "test-key",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
      },
      patch: { workspaceRoot: process.cwd() },
    });

    const instance = await manager.spawn(config, async ({ sessionId, store, workspaceRoot, plugins }) => {
      const composition = createMinimalComposition({
        workspaceRoot,
        sessionStore: store,
        sessionId,
        plugins,
        llm: createReplayAdapter([{ content: "pong-http" }]),
        assemble: true,
      });
      return composition.createAgent();
    });

    const port = instance.health().port!;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);

    const unauth = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "ping" }),
    });
    expect(unauth.status).toBe(401);

    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key",
      },
      body: JSON.stringify({ message: "ping" }),
    });
    expect(chat.status).toBe(200);
    const body = (await chat.json()) as { text: string; sessionId: string };
    expect(body.text).toBe("pong-http");
    expect(body.sessionId).toBeTruthy();

    await manager.stopAll();
  });

  it("newSession + admit-only + turn resume", async () => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        XRK_API_KEY: "test-key",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
      },
      patch: { workspaceRoot: process.cwd() },
    });

    const instance = await manager.spawn(config, async ({ sessionId, store, workspaceRoot, plugins }) => {
      const composition = createMinimalComposition({
        workspaceRoot,
        sessionStore: store,
        sessionId,
        plugins,
        llm: createReplayAdapter([{ content: "from-admit" }]),
        assemble: true,
      });
      return composition.createAgent();
    });

    const port = instance.health().port!;
    const base = `http://127.0.0.1:${port}`;
    const auth = {
      "content-type": "application/json",
      authorization: "Bearer test-key",
    };

    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const admitted = await fetch(`${base}/api/sessions/${sessionId}/admit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "parked" }),
    });
    expect(admitted.status).toBe(202);
    const admitBody = (await admitted.json()) as { admitId: string; pending: number };
    expect(admitBody.admitId).toBeTruthy();
    expect(admitBody.pending).toBe(1);

    const turned = await fetch(`${base}/api/sessions/${sessionId}/turn`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(turned.status).toBe(200);
    const turnBody = (await turned.json()) as { text: string; admitId?: string };
    expect(turnBody.text).toBe("from-admit");
    expect(turnBody.admitId).toBe(admitBody.admitId);

    await manager.stopAll();
  });

  it("admit wake schedules drain without blocking", async () => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        XRK_API_KEY: "test-key",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
      },
      patch: { workspaceRoot: process.cwd() },
    });

    const instance = await manager.spawn(config, async ({ sessionId, store, workspaceRoot, plugins }) => {
      const composition = createMinimalComposition({
        workspaceRoot,
        sessionStore: store,
        sessionId,
        llm: createReplayAdapter([{ content: "woken" }]),
        assemble: true,
        plugins,
      });
      return composition.createAgent();
    });

    const port = instance.health().port!;
    const base = `http://127.0.0.1:${port}`;
    const auth = {
      "content-type": "application/json",
      authorization: "Bearer test-key",
    };

    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const admitted = await fetch(`${base}/api/sessions/${sessionId}/admit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "async-park", wake: true }),
    });
    expect(admitted.status).toBe(202);
    const body = (await admitted.json()) as {
      scheduled?: boolean;
      pending: number;
    };
    expect(body.scheduled).toBe(true);

    // Join until drain finishes (OpenCode run/join).
    await instance.drain.run(sessionId);
    const events = instance.store.get(sessionId).events;
    expect(
      events.some(
        (e) => e.type === "assistant/message" && e.content === "woken",
      ),
    ).toBe(true);

    await manager.stopAll();
  });

  it("admit delivery=steer promotes ahead of older queue", async () => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        XRK_API_KEY: "test-key",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
      },
      patch: { workspaceRoot: process.cwd() },
    });

    const instance = await manager.spawn(config, async ({ sessionId, store, workspaceRoot, plugins }) => {
      const composition = createMinimalComposition({
        workspaceRoot,
        sessionStore: store,
        sessionId,
        llm: createReplayAdapter([{ content: "ok" }]),
        assemble: true,
        plugins,
      });
      return composition.createAgent();
    });

    const port = instance.health().port!;
    const base = `http://127.0.0.1:${port}`;
    const auth = {
      "content-type": "application/json",
      authorization: "Bearer test-key",
    };

    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const bad = await fetch(`${base}/api/sessions/${sessionId}/admit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "x", delivery: "asap" }),
    });
    expect(bad.status).toBe(400);

    await fetch(`${base}/api/sessions/${sessionId}/admit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "queued-first" }),
    });
    const steered = await fetch(`${base}/api/sessions/${sessionId}/admit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "steer-me", delivery: "steer" }),
    });
    expect(steered.status).toBe(202);
    const steerBody = (await steered.json()) as {
      admitId: string;
      delivery: string;
    };
    expect(steerBody.delivery).toBe("steer");

    const turned = await fetch(`${base}/api/sessions/${sessionId}/turn`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(turned.status).toBe(200);
    const turnBody = (await turned.json()) as { admitId?: string };
    expect(turnBody.admitId).toBe(steerBody.admitId);
    expect(
      instance.store
        .get(sessionId)
        .events.some(
          (e) => e.type === "user/message" && e.content === "steer-me",
        ),
    ).toBe(true);

    await manager.stopAll();
  });

  it("loads pluginsDir and wires tools into agent registry", async () => {
    const extRoot = path.resolve(
      import.meta.dirname,
      "../../../../extensions",
    );
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        XRK_API_KEY: "",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
        XRK_PLUGINS_DIR: extRoot,
      },
      patch: { workspaceRoot: process.cwd() },
    });

    let toolNames: string[] = [];
    const instance = await manager.spawn(
      config,
      async ({ sessionId, store, workspaceRoot, plugins }) => {
        const composition = createMinimalComposition({
          workspaceRoot,
          sessionStore: store,
          sessionId,
          plugins,
          llm: createReplayAdapter([{ content: "ok" }]),
          assemble: false,
        });
        toolNames = composition.tools.list().map((t) => t.name);
        return composition.createAgent();
      },
    );

    expect(instance.loadedPluginIds).toContain("example-tools");
    expect(instance.health().plugins).toContain("example-tools");
    expect(
      instance.loader.list().find((p) => p.id === "example-tools")?.tools?.map(
        (t) => t.name,
      ),
    ).toContain("example_ping");

    const port = instance.health().port!;
    const chat = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x" }),
    });
    expect(chat.status).toBe(200);
    expect(toolNames).toContain("example_ping");
    expect(toolNames).toContain("read_file");

    await manager.stopAll();
    expect(instance.loader.list()).toEqual([]);
  });
});
