import { describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";

const WEB_DIST = path.resolve(process.cwd(), "apps", "web", "dist");
const HAS_SHELL = existsSync(path.join(WEB_DIST, "index.html"));

async function faceRpc(
  base: string,
  method: string,
  payload: unknown = {},
): Promise<{ ok: boolean; value?: unknown; error?: { code: string } }> {
  const res = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rpcId: method, payload }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { ok: boolean; value?: unknown; error?: { code: string } };
  };
  return body.result;
}

describe.skipIf(!HAS_SHELL)("product shell first paint", () => {
  it(
    "serves apps/web/dist + boot inject + first-paint RPCs",
    async () => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        XRK_API_KEY: "",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
      },
      patch: {
        workspaceRoot: process.cwd(),
        webDist: WEB_DIST,
      },
    });

    const instance = await manager.spawn(
      config,
      async ({ sessionId, store, workspaceRoot, plugins }) =>
        createMinimalComposition({
          workspaceRoot,
          sessionStore: store,
          sessionId,
          plugins,
          llm: createReplayAdapter([{ content: "pong-shell" }]),
          assemble: true,
        }).createAgent(),
    );

    try {
      const port = instance.health().port!;
      const base = `http://127.0.0.1:${port}`;

      const htmlRes = await fetch(`${base}/`);
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain("__DSH_BOOT__");
      expect(html).toContain("@deepseek-ai/dsh-client-runtime");
      expect(html).toContain("@deepseek-ai/dsh-client-ui-conversation");
      expect(html).not.toContain("dsh-client-ui-cordis");
      expect(html).not.toContain("dsh-cordis-client-runner");
      expect(html).not.toContain("dsh-client-hmr");

      const welcomeJs = await readFile(
        path.join(
          WEB_DIST,
          "plugins",
          "@deepseek-ai",
          "dsh-client-ui-settings-models",
          "client.js",
        ),
        "utf8",
      );
      expect(welcomeJs).toContain("XRK Harness Web UI");
      expect(welcomeJs).toContain("2026-08-17.xrk1");

      const plugin = await fetch(
        `${base}/plugins/@deepseek-ai/dsh-client-runtime/client.js`,
        { method: "HEAD" },
      );
      expect(plugin.status).toBe(200);
      expect(plugin.headers.get("content-type") ?? "").toMatch(/javascript/);

      const missing = await fetch(
        `${base}/plugins/@deepseek-ai/does-not-exist/client.js`,
      );
      expect(missing.status).toBe(404);
      expect(await missing.text()).not.toContain("<!doctype html>");

      const manifest = await fetch(`${base}/manifest.webmanifest`);
      expect(manifest.status).toBe(200);
      expect(manifest.headers.get("content-type") ?? "").toMatch(/manifest/);
      const manifestBody = (await manifest.json()) as { name: string };
      expect(manifestBody.name).toBe("XRK Harness");

      const described = await faceRpc(base, "host.describe");
      expect(described.ok).toBe(true);
      expect(described.value).toMatchObject({
        cwd: process.cwd(),
        canOpenPath: true,
        attachedSessions: expect.any(Number),
      });

      const listed = await faceRpc(base, "session.list");
      expect(listed.ok).toBe(true);

      const presets = await faceRpc(base, "agentPreset.list");
      expect(presets.ok).toBe(true);
      expect(presets.value).toMatchObject({ authorable: false });

      const inventory = await faceRpc(base, "pluginInventory/list", {
        args: {},
      });
      expect(inventory.ok).toBe(true);

      const cordis = await faceRpc(base, "dynamicCordisRunner/inventory", {
        args: {},
      });
      expect(cordis).toEqual({ ok: true, value: [] });

      const workspaces = await faceRpc(base, "workspace.list");
      expect(workspaces.ok).toBe(true);
    } finally {
      await manager.stopAll();
    }
  },
  20_000,
);
});
