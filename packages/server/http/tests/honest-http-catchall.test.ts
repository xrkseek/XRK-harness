import { describe, expect, it } from "vitest";
import {
  shouldHonestHttpCatchall,
  handleHonestHttpCatchall,
} from "../src/dsh-compat/honest-http-catchall.js";
import { incompleteCommunityApiBody } from "../src/dsh-compat/incomplete-api-shapes.js";
import { createServer } from "node:http";

describe("honest-http-catchall", () => {
  it("skips product and harness paths", () => {
    expect(shouldHonestHttpCatchall("/api/harness/connector/jobs")).toBe(false);
    expect(shouldHonestHttpCatchall("/api/cron/jobs")).toBe(false);
    expect(shouldHonestHttpCatchall("/api/cron/jobs/x/logs")).toBe(false);
    expect(shouldHonestHttpCatchall("/xrk/plugins/inventory")).toBe(false);
    expect(shouldHonestHttpCatchall("/plugins/foo/client.js")).toBe(false);
    expect(shouldHonestHttpCatchall("/boot.json")).toBe(false);
    expect(shouldHonestHttpCatchall("/some-plugin/foo")).toBe(true);
  });

  it("path-shaped incomplete bodies include arrays Settings panels filter", () => {
    const summary = incompleteCommunityApiBody("/api/our-free-model/summary");
    expect(Array.isArray(summary?.catalog)).toBe(true);
    expect(summary?.settings).toEqual(
      expect.objectContaining({ enabled: true }),
    );
    const stats = incompleteCommunityApiBody("/api/our-free-model/stats");
    expect(Array.isArray(stats?.days)).toBe(true);
    expect(Array.isArray(stats?.models)).toBe(true);
    expect(Array.isArray(stats?.samples)).toBe(true);
    expect(incompleteCommunityApiBody("/api/pet/state")).toBeUndefined();
  });

  it("responds to GET with incomplete envelope (not fake ready)", async () => {
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
        const body = (await res.json()) as {
          ok: boolean;
          status: string;
        };
        expect(res.status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.status).toBe("incomplete");
        server.close(() => resolve());
      });
    });
  });

  it("OFM summary path-shape returns catalog array before generic envelope", async () => {
    const server = createServer((req, res) => {
      void handleHonestHttpCatchall(
        req,
        res,
        "/api/our-free-model/summary",
      ).then((claimed) => {
        if (!claimed) {
          res.writeHead(404);
          res.end("no");
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, async () => {
        const addr = server.address();
        const port =
          typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(
          `http://127.0.0.1:${port}/api/our-free-model/summary`,
        );
        const body = (await res.json()) as {
          catalog: unknown[];
          incomplete?: string[];
        };
        expect(res.status).toBe(200);
        expect(Array.isArray(body.catalog)).toBe(true);
        expect(body.incomplete).toContain("dsh-host");
        server.close(() => resolve());
      });
    });
  });

  it("OFM stats path-shape returns days/models/samples arrays", async () => {
    const server = createServer((req, res) => {
      void handleHonestHttpCatchall(
        req,
        res,
        "/api/our-free-model/stats",
      ).then((claimed) => {
        if (!claimed) {
          res.writeHead(404);
          res.end("no");
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, async () => {
        const addr = server.address();
        const port =
          typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(
          `http://127.0.0.1:${port}/api/our-free-model/stats`,
        );
        const body = (await res.json()) as {
          days: unknown[];
          models: unknown[];
          samples: unknown[];
          incomplete?: string[];
        };
        expect(res.status).toBe(200);
        expect(Array.isArray(body.days)).toBe(true);
        expect(Array.isArray(body.models)).toBe(true);
        expect(Array.isArray(body.samples)).toBe(true);
        expect(body.incomplete).toContain("dsh-host");
        server.close(() => resolve());
      });
    });
  });
});
