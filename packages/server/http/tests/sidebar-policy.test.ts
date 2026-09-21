import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  createPolicyEngine,
  denyHostOpenActions,
  denySidebarEmbedSchemes,
  denySidebarFsOps,
  askHostOpenActions,
} from "@xrkseek/policy";
import { createSidebarPublicHandler } from "../src/sidebar/index.js";
import type { SidebarFaceBridge } from "../src/sidebar/sidebar-face-bridge.js";

async function withHandler(
  options: Parameters<typeof createSidebarPublicHandler>[0],
  run: (base: string) => Promise<void>,
): Promise<void> {
  const handler = createSidebarPublicHandler(options);
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

describe("sidebar Host policy gates", () => {
  it("denies browser.probe for blocked schemes", async () => {
    const policy = createPolicyEngine({
      rules: [denySidebarEmbedSchemes(["http"])],
    });
    await withHandler({ policy }, async (base) => {
      const res = await fetch(`${base}/sidebar/api/browser.probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://insecure.example/" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("policy-denied");
      expect(
        (body.error as { details?: { kind?: string } } | undefined)?.details
          ?.kind,
      ).toBe("sidebar.embed");
    });
  });

  it("denies open.external url when host.open url is denied", async () => {
    const policy = createPolicyEngine({
      rules: [denyHostOpenActions(["url"])],
    });
    const bridge: SidebarFaceBridge = {
      async openExternal() {
        throw new Error("should not open");
      },
    };
    await withHandler({ policy, sidebarFace: bridge }, async (base) => {
      const res = await fetch(`${base}/sidebar/api/open.external`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "url",
          url: "https://example.com",
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("policy-denied");
    });
  });

  it("returns policy-ask (not deny) when host.open asks and no seam", async () => {
    const policy = createPolicyEngine({
      rules: [askHostOpenActions(["url"])],
    });
    const bridge: SidebarFaceBridge = {
      async openExternal() {
        throw new Error("should not open");
      },
    };
    await withHandler({ policy, sidebarFace: bridge }, async (base) => {
      const res = await fetch(`${base}/sidebar/api/open.external`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "url",
          url: "https://example.com",
          sessionId: "sess-ask",
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("policy-ask");
      expect(
        (body.error as { details?: { kind?: string } } | undefined)?.details
          ?.kind,
      ).toBe("host.open");
    });
  });

  it("omitted policy uses product defaults (sidebar.fs allow)", async () => {
    await withHandler({}, async (base) => {
      // No policy inject — gate still evaluates DEFAULT_POLICY_VERDICTS.
      const res = await fetch(`${base}/sidebar/api/browser.probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      // Default sidebar.embed is allow; probe may fail network but not policy-denied.
      expect(body.ok === true || body.ok === false).toBe(true);
      if (!body.ok) {
        const err = (body as { error?: { code?: string } }).error;
        expect(err?.code).not.toBe("policy-denied");
      }
    });
  });

  it("awaits ask seam: allow continues, reject denies", async () => {
    const policy = createPolicyEngine({
      rules: [askHostOpenActions(["url"])],
    });
    const opened: string[] = [];
    const bridge: SidebarFaceBridge = {
      async openExternal(req) {
        opened.push(String(req.url ?? ""));
      },
    };
    let allowNext = true;
    await withHandler(
      {
        policy,
        sidebarFace: bridge,
        resolvePolicyAsk: async () => {
          const v = allowNext;
          return v;
        },
      },
      async (base) => {
        const okRes = await fetch(`${base}/sidebar/api/open.external`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "url",
            url: "https://allowed.example/",
            sessionId: "sess-ask",
          }),
        });
        const okBody = (await okRes.json()) as { ok: boolean };
        expect(okBody.ok).toBe(true);
        expect(opened).toEqual(["https://allowed.example/"]);

        allowNext = false;
        const denyRes = await fetch(`${base}/sidebar/api/open.external`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "url",
            url: "https://denied.example/",
            sessionId: "sess-ask",
          }),
        });
        const denyBody = (await denyRes.json()) as {
          ok: boolean;
          error?: { code: string };
        };
        expect(denyBody.ok).toBe(false);
        expect(denyBody.error?.code).toBe("policy-denied");
        expect(opened).toEqual(["https://allowed.example/"]);
      },
    );
  });
});
