import { describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";
import { isolatedHostEnv, withIsolatedXrkHome } from "./helpers/isolated-xrk-home.js";

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
    await withIsolatedXrkHome(async (xrkHome) => {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: isolatedHostEnv(xrkHome, { XRK_API_KEY: "" }),
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
      expect(html).toContain("__XRK_BOOT__");
      expect(html).toContain("@xrkseek/client-runtime");
      expect(html).toContain("@xrkseek/client-ui-conversation");
      expect(html).not.toContain("client-ui-cordis");
      expect(html).not.toContain("xrk-cordis-client-runner");
      expect(html).not.toContain("client-hmr");

      const welcomeJs = await readFile(
        path.join(
          WEB_DIST,
          "plugins",
          "@xrkseek",
          "client-ui-settings-models",
          "client.js",
        ),
        "utf8",
      );
      expect(welcomeJs).toContain("Welcome to XRK-Harness");
      expect(welcomeJs).toContain("2026-08-23.1");

      const plugin = await fetch(
        `${base}/plugins/@xrkseek/client-runtime/client.js`,
        { method: "HEAD" },
      );
      expect(plugin.status).toBe(200);
      expect(plugin.headers.get("content-type") ?? "").toMatch(/javascript/);

      const typert = await fetch(
        `${base}/plugins/@xrkseek/xrk-typert-registry/client.js`,
        { method: "HEAD" },
      );
      expect(typert.status).toBe(200);

      const bootRes = await fetch(`${base}/boot.json`);
      expect(bootRes.status).toBe(200);
      const boot = (await bootRes.json()) as { entries: { id: string }[] };
      const bootIds = boot.entries.map((e) => e.id);
      expect(bootIds).toEqual(
        expect.arrayContaining([
          "@xrkseek/xrk-typert-registry",
          "@xrkseek/xrk-api-gateway",
          "@xrkseek/xrk-api-remotes",
          "@xrkseek/client-ui-reference",
        ]),
      );

      const missing = await fetch(
        `${base}/plugins/@xrkseek/does-not-exist/client.js`,
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

      const workspaces = await faceRpc(base, "workspace.list");
      expect(workspaces.ok).toBe(true);

      // Immediately-tier locale/theme + welcome/agent-preset fire this on connect.
      const settings = await faceRpc(base, "settings.describe");
      expect(settings.ok).toBe(true);
      expect(settings.value).toMatchObject({
        namespaces: expect.any(Array),
      });
      expect(
        (settings.value as { namespaces: unknown[] }).namespaces.length,
      ).toBeGreaterThan(0);

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
      expect(cordis.ok).toBe(true);
      const cordisRows = (cordis.value ?? []) as Array<{
        pluginId: string;
        hostBridge?: string;
        fiberPhase?: string;
      }>;
      expect(cordisRows.length).toBeGreaterThan(0);
      expect(
        cordisRows.some(
          (row) =>
            row.pluginId === "@xrkseek/client-runtime" &&
            row.fiberPhase === "active" &&
            row.hostBridge === "xrk-dsh-compat",
        ),
      ).toBe(true);
    } finally {
      await manager.stopAll();
    }
    });
  },
  20_000,
);
});
