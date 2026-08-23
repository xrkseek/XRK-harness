import { describe, expect, it } from "vitest";
import {
  shouldHonestHttpCatchall,
  handleHonestHttpCatchall,
} from "../src/dsh-compat/honest-http-catchall.js";
import { createServer } from "node:http";

describe("honest-http-catchall", () => {
  it("skips product and harness paths", () => {
    expect(shouldHonestHttpCatchall("/api/harness/connector/jobs")).toBe(false);
    expect(shouldHonestHttpCatchall("/xrk/plugins/inventory")).toBe(false);
    expect(shouldHonestHttpCatchall("/plugins/foo/client.js")).toBe(false);
    expect(shouldHonestHttpCatchall("/boot.json")).toBe(false);
    expect(shouldHonestHttpCatchall("/some-plugin/foo")).toBe(true);
  });

  it("responds to GET with honest JSON", async () => {
    const server = createServer((req, res) => {
      void handleHonestHttpCatchall(req, res, "/residual/pkg/status").then(
        (claimed) => {
          if (!claimed) {
            res.writeHead(404);
            res.end("no");
          }
        },
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, async () => {
        const addr = server.address();
        const port =
          typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(
          `http://127.0.0.1:${port}/residual/pkg/status`,
        );
        const body = (await res.json()) as { ok: boolean; status: string };
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.status).toBe("ready");
        server.close(() => resolve());
      });
    });
  });
});
