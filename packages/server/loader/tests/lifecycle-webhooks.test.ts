/** Outbound lifecycle webhooks: parse, fail-open POST, HMAC, matcher. */
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLifecycleWebhookNotifier,
  loadLifecycleWebhooks,
  parseLifecycleWebhooks,
} from "../src/lifecycle-webhooks.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseLifecycleWebhooks", () => {
  it("reads outbound targets and Hermes hooks.outbound shape", () => {
    expect(
      parseLifecycleWebhooks({
        outbound: [
          {
            name: "ci",
            url: "https://hooks.example.com/xrk",
            events: ["turn/end", "tool/post", "bogus"],
            secretEnv: "XRK_WEBHOOK_SECRET",
            matcher: "bash",
            timeoutMs: 5_000,
          },
          { url: "not-a-url", events: ["turn/end"] },
          { url: "https://ok.example/a", events: [] },
        ],
      }),
    ).toEqual([
      {
        name: "ci",
        url: "https://hooks.example.com/xrk",
        events: ["turn/end", "tool/post"],
        secretEnv: "XRK_WEBHOOK_SECRET",
        matcher: "bash",
        timeoutMs: 5_000,
      },
    ]);

    expect(
      parseLifecycleWebhooks({
        hooks: {
          outbound: [
            {
              url: "http://127.0.0.1:9/hook",
              events: ["turn/start"],
              secret_env: "S",
              timeout: 2,
            },
          ],
        },
      }),
    ).toEqual([
      {
        url: "http://127.0.0.1:9/hook",
        events: ["turn/start"],
        secretEnv: "S",
        timeoutMs: 2_000,
      },
    ]);
  });
});

describe("loadLifecycleWebhooks", () => {
  it("skips missing files and loads valid webhooks.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-webhooks-"));
    const file = path.join(dir, "webhooks.json");
    writeFileSync(
      file,
      JSON.stringify({
        outbound: [
          { url: "https://example.test/h", events: ["turn/end"] },
        ],
      }),
    );
    expect(
      loadLifecycleWebhooks([path.join(dir, "missing.json"), file]),
    ).toEqual([{ url: "https://example.test/h", events: ["turn/end"] }]);
  });
});

describe("createLifecycleWebhookNotifier", () => {
  it("POSTs turn/end with HMAC and skips unmatched tool/post", async () => {
    const posts: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      posts.push({ url, init });
      return new Response("", { status: 204 });
    });
    const notifier = createLifecycleWebhookNotifier({
      sessionId: "s1",
      workspaceRoot: "/ws",
      env: { XRK_WEBHOOK_SECRET: "sekrit" },
      fetchImpl,
      now: () => new Date("2026-09-21T02:00:00.000Z"),
      targets: [
        {
          url: "https://hooks.example.com/xrk",
          events: ["turn/end", "tool/post"],
          secretEnv: "XRK_WEBHOOK_SECRET",
          matcher: "bash",
        },
      ],
    });

    notifier.fire({
      hookEventName: "turn/end",
      turnId: "t1",
      extra: { reason: { kind: "completed" } },
    });
    notifier.fireToolPost({
      toolName: "read_file",
      toolUseId: "c1",
      isError: false,
      skippedBody: false,
    });
    notifier.fireToolPost({
      toolName: "bash",
      toolUseId: "c2",
      isError: true,
      skippedBody: false,
    });

    await vi.waitFor(() => {
      expect(posts).toHaveLength(2);
    });

    expect(posts[0]?.url).toBe("https://hooks.example.com/xrk");
    const headers = posts[0]?.init.headers as Record<string, string>;
    expect(headers["x-xrk-event"]).toBe("turn/end");
    const body = String(posts[0]?.init.body);
    const expectedSig = `sha256=${createHmac("sha256", "sekrit")
      .update(body)
      .digest("hex")}`;
    expect(headers["x-xrk-signature-256"]).toBe(expectedSig);
    expect(JSON.parse(body)).toMatchObject({
      hookEventName: "turn/end",
      sessionId: "s1",
      turnId: "t1",
      workspaceRoot: "/ws",
      timestamp: "2026-09-21T02:00:00.000Z",
    });

    expect(JSON.parse(String(posts[1]?.init.body))).toMatchObject({
      hookEventName: "tool/post",
      toolName: "bash",
      isError: true,
    });
  });

  it("fail-opens when fetch rejects and skips under XRK_SAFE_MODE", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const notifier = createLifecycleWebhookNotifier({
      sessionId: "s1",
      workspaceRoot: "/ws",
      fetchImpl,
      targets: [
        { url: "https://hooks.example.com/xrk", events: ["turn/start"] },
      ],
    });
    expect(() =>
      notifier.fire({ hookEventName: "turn/start", turnId: "t1" }),
    ).not.toThrow();
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });

    const safe = createLifecycleWebhookNotifier({
      sessionId: "s1",
      workspaceRoot: "/ws",
      env: { XRK_SAFE_MODE: "1" },
      fetchImpl,
      targets: [
        { url: "https://hooks.example.com/xrk", events: ["turn/start"] },
      ],
    });
    const before = fetchImpl.mock.calls.length;
    safe.fire({ hookEventName: "turn/start", turnId: "t2" });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl.mock.calls.length).toBe(before);
  });
});
