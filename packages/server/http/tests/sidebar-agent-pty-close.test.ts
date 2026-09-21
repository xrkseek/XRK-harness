import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createSidebarPublicHandler } from "../src/sidebar/index.js";

async function withHandler(
  closeAgentPty: ((uuid: string) => boolean) | undefined,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const handler = createSidebarPublicHandler({
    ...(closeAgentPty
      ? { agentRegistries: { closeAgentPty } }
      : {}),
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

describe("sidebar agent-pty.close", () => {
  it("forwards uuid close to the Host registry", async () => {
    const closed: string[] = [];
    await withHandler(
      (uuid) => {
        closed.push(uuid);
        return true;
      },
      async (base) => {
        const res = await fetch(`${base}/sidebar/api/agent-pty.close`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uuid: "term-1" }),
        });
        const body = (await res.json()) as {
          ok: boolean;
          value: { closed: boolean };
        };
        expect(body.ok).toBe(true);
        expect(body.value.closed).toBe(true);
        expect(closed).toEqual(["term-1"]);
      },
    );
  });
});
