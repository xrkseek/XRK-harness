import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createSidebarPublicHandler } from "../src/sidebar/index.js";
import type { SidebarFaceBridge } from "../src/sidebar/sidebar-face-bridge.js";

async function withHandler(
  bridge: SidebarFaceBridge | undefined,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const handler = createSidebarPublicHandler({
    ...(bridge ? { sidebarFace: bridge } : {}),
  });
  const server = createServer((req, res) => {
    void (async () => {
      const claimed = await handler(req, res);
      if (!claimed) {
        res.writeHead(404);
        res.end("no");
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("sidebar subagents.preview / plan.preview", () => {
  it("returns empty previews without Face bridge", async () => {
    await withHandler(undefined, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootSessionId: "root" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { previews: unknown[] };
      };
      expect(body.ok).toBe(true);
      expect(body.value.previews).toEqual([]);
    });
  });

  it("forwards listSubagentPreviews from the bridge", async () => {
    const bridge: SidebarFaceBridge = {
      async openExternal() {
        return { ok: true };
      },
      async listSubagentPreviews(rootSessionId) {
        expect(rootSessionId).toBe("root");
        return {
          previews: [
            {
              childSessionId: "child-1",
              mode: "continuable",
              activity: "running",
              label: "worker",
              live: { text: "typing" },
              lastAssistantPreview: "done",
            },
          ],
        };
      },
    };
    await withHandler(bridge, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootSessionId: "root" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: {
          previews: Array<{
            childSessionId: string;
            label?: string;
            activity: string;
          }>;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.value.previews).toHaveLength(1);
      expect(body.value.previews[0]?.childSessionId).toBe("child-1");
      expect(body.value.previews[0]?.label).toBe("worker");
      expect(body.value.previews[0]?.activity).toBe("running");
    });
  });

  it("requires sessionId for plan.preview and defaults without bridge", async () => {
    await withHandler(undefined, async (base) => {
      const missing = await fetch(`${base}/sidebar/api/plan.preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const missingBody = (await missing.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(missingBody.ok).toBe(false);
      expect(missingBody.error?.code).toBe("bad-request");

      const idle = await fetch(`${base}/sidebar/api/plan.preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      });
      const idleBody = (await idle.json()) as {
        ok: boolean;
        value: { active: boolean; pending: boolean };
      };
      expect(idleBody.ok).toBe(true);
      expect(idleBody.value).toEqual({ active: false, pending: false });
    });
  });

  it("forwards getPlanPreview from the bridge", async () => {
    const bridge: SidebarFaceBridge = {
      async openExternal() {
        return { ok: true };
      },
      async getPlanPreview(sessionId) {
        expect(sessionId).toBe("s1");
        return { active: true, pending: true };
      },
    };
    await withHandler(bridge, async (base) => {
      const res = await fetch(`${base}/sidebar/api/plan.preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { active: boolean; pending: boolean };
      };
      expect(body.ok).toBe(true);
      expect(body.value).toEqual({ active: true, pending: true });
    });
  });

  it("returns an empty team graph without a bridge and forwards link", async () => {
    await withHandler(undefined, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootSessionId: "root" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { nodes: unknown[]; edges: unknown[] };
      };
      expect(body.ok).toBe(true);
      expect(body.value).toEqual({ nodes: [], edges: [] });
    });

    const bridge: SidebarFaceBridge = {
      async openExternal() {
        return { ok: true };
      },
      async agentTeamGraph(rootSessionId, action) {
        expect(rootSessionId).toBe("root");
        expect(action?.op).toBe("link");
        return {
          nodes: [
            { id: "root", label: "root" },
            { id: "peer", label: "peer" },
          ],
          edges: [{ from: "peer", to: "root", kind: "peer", label: "review" }],
        };
      },
    };
    await withHandler(bridge, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootSessionId: "root",
          op: "link",
          from: "root",
          to: "peer",
          label: "review",
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { edges: Array<{ kind: string }> };
      };
      expect(body.ok).toBe(true);
      expect(body.value.edges[0]?.kind).toBe("peer");
    });
  });

  it("forwards a role override to the bridge", async () => {
    const bridge: SidebarFaceBridge = {
      async openExternal() {
        return { ok: true };
      },
      async agentTeamGraph(rootSessionId, action) {
        expect(rootSessionId).toBe("root");
        expect(action).toEqual({
          op: "role",
          nodeId: "worker-1",
          role: "observer",
        });
        return {
          nodes: [{ id: "worker-1", label: "worker", role: "observer" }],
          edges: [],
        };
      },
    };
    await withHandler(bridge, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootSessionId: "root",
          op: "role",
          nodeId: "worker-1",
          role: "observer",
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { nodes: Array<{ id: string; role?: string }> };
      };
      expect(body.ok).toBe(true);
      expect(body.value.nodes[0]?.role).toBe("observer");
    });

    // `sessionId` is accepted as an alias for `nodeId`, and omitting `role`
    // clears back to the derived value.
    const clearBridge: SidebarFaceBridge = {
      async openExternal() {
        return { ok: true };
      },
      async agentTeamGraph(_rootSessionId, action) {
        expect(action).toEqual({ op: "role", nodeId: "worker-1" });
        return { nodes: [], edges: [] };
      },
    };
    await withHandler(clearBridge, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootSessionId: "root",
          op: "role",
          sessionId: "worker-1",
        }),
      });
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });
});
