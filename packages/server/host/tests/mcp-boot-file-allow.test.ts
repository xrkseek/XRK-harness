import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "../src/index.js";
import {
  isolatedHostEnv,
  withIsolatedXrkHome,
} from "./helpers/isolated-xrk-home.js";

type McpView = {
  connecting?: readonly string[];
  connected?: readonly { serverName?: string }[];
  connectFailures?: readonly { serverName?: string }[];
};

async function settingsMcp(instance: {
  http: { fetch: (req: Request) => Promise<Response> };
}): Promise<McpView | undefined> {
  // MCP live overlays (connecting / connected / failures) live on
  // `settings.describe` namespaces — not legacy `settings.get` scopes.
  const res = await instance.http.fetch(
    new Request("http://desktop.local/api/settings.describe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rpcId: "mcp-describe", payload: {} }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result?: {
      ok?: boolean;
      value?: {
        namespaces?: readonly { ns?: string; value?: McpView }[];
      };
    };
  };
  expect(body.result?.ok).toBe(true);
  return body.result?.value?.namespaces?.find((n) => n.ns === "mcp")?.value;
}

describe("host MCP file-sourced boot with allow already on", () => {
  it(
    "background-connects Settings MCP when allowConnect is persisted",
    async () => {
      await withIsolatedXrkHome(async (xrkHome) => {
        await writeFile(
          path.join(xrkHome, "host-settings.json"),
          `${JSON.stringify(
            {
              mcp: {
                allowConnect: true,
                servers: [
                  {
                    serverName: "boot-probe",
                    command: process.execPath,
                    args: ["-e", "setInterval(() => {}, 1e9)"],
                  },
                ],
              },
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        const manager = createHostManager();
        const config = loadHostConfig({
          env: isolatedHostEnv(xrkHome, { XRK_API_KEY: "test-key" }),
          patch: {
            workspaceRoot: process.cwd(),
            listen: false,
            webDist: path.join(process.cwd(), "apps", "web", "dist"),
          },
        });
        const instance = await manager.spawn(
          config,
          async ({ sessionId, store, workspaceRoot, plugins }) => {
            const composition = createMinimalComposition({
              workspaceRoot,
              sessionStore: store,
              sessionId,
              plugins,
              llm: createReplayAdapter([{ content: "unused" }]),
              assemble: true,
            });
            return composition.createAgent();
          },
        );

        const health = await instance.http.fetch(
          new Request("http://desktop.local/health"),
        );
        expect(health.status).toBe(200);

        const deadline = Date.now() + 12_000;
        let connectingOrLive = false;
        while (Date.now() < deadline) {
          const mcp = await settingsMcp(instance);
          const connecting = mcp?.connecting ?? [];
          const connected = mcp?.connected ?? [];
          const failures = mcp?.connectFailures ?? [];
          if (
            connecting.includes("boot-probe") ||
            connected.some((e) => e.serverName === "boot-probe") ||
            failures.some((e) => e.serverName === "boot-probe")
          ) {
            connectingOrLive = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(connectingOrLive).toBe(true);
        await manager.stopAll();
      });
    },
    20_000,
  );

  it("still defers file-sourced MCP when allowConnect is off", async () => {
    await withIsolatedXrkHome(async (xrkHome) => {
      await writeFile(
        path.join(xrkHome, "host-settings.json"),
        `${JSON.stringify(
          {
            mcp: {
              allowConnect: false,
              servers: [
                {
                  serverName: "parked-probe",
                  command: process.execPath,
                  args: ["-e", "setInterval(() => {}, 1e9)"],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const manager = createHostManager();
      const config = loadHostConfig({
        env: isolatedHostEnv(xrkHome, { XRK_API_KEY: "test-key" }),
        patch: {
          workspaceRoot: process.cwd(),
          listen: false,
          webDist: path.join(process.cwd(), "apps", "web", "dist"),
        },
      });
      const instance = await manager.spawn(
        config,
        async ({ sessionId, store, workspaceRoot, plugins }) => {
          const composition = createMinimalComposition({
            workspaceRoot,
            sessionStore: store,
            sessionId,
            plugins,
            llm: createReplayAdapter([{ content: "unused" }]),
            assemble: true,
          });
          return composition.createAgent();
        },
      );

      await new Promise((r) => setTimeout(r, 400));
      const mcp = await settingsMcp(instance);
      expect(mcp?.connecting ?? []).not.toContain("parked-probe");
      expect(mcp?.connected ?? []).toEqual([]);
      await manager.stopAll();
    });
  });
});
