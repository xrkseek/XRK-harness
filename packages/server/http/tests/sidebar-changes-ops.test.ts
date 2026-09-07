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

describe("sidebar changes.ops", () => {
  it("returns empty window without Face bridge", async () => {
    await withHandler(undefined, async (base) => {
      const res = await fetch(`${base}/sidebar/api/changes.ops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { events: unknown[]; lastSeq: number };
      };
      expect(body.ok).toBe(true);
      expect(body.value.events).toEqual([]);
      expect(body.value.lastSeq).toBe(0);
    });
  });

  it("forwards Face wire tool events past afterSeq", async () => {
    const bridge: SidebarFaceBridge = {
      async openExternal() {
        return { ok: true };
      },
      listChangesOps(sessionId, afterSeq) {
        expect(sessionId).toBe("s1");
        expect(afterSeq).toBe(2);
        return {
          events: [
            {
              type: "tool/call",
              seq: 3,
              time: 1,
              data: {
                callId: "c1",
                name: "write_file",
                arguments: '{"path":"a.ts"}',
              },
            },
          ],
          lastSeq: 3,
        };
      },
    };
    await withHandler(bridge, async (base) => {
      const res = await fetch(`${base}/sidebar/api/changes.ops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", afterSeq: 2 }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: {
          events: Array<{ type: string; seq: number; data: { callId: string } }>;
          lastSeq: number;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.value.lastSeq).toBe(3);
      expect(body.value.events).toHaveLength(1);
      expect(body.value.events[0]?.type).toBe("tool/call");
      expect(body.value.events[0]?.data.callId).toBe("c1");
    });
  });
});
