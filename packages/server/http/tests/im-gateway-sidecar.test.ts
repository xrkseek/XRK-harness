import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDshCompatPublicHandler } from "../src/index.js";
import {
  imGatewaySidecarStatusPayload,
  probeImGatewaySidecar,
  readImGatewaySidecarConfig,
} from "../src/dsh-compat/im-gateway-sidecar.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function withUpstream(
  run: (base: string) => Promise<void>,
): Promise<void> {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, status: "ok" }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const addr = upstream.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      upstream.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function withPublicHandler(
  handler: ReturnType<typeof createDshCompatPublicHandler>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    void (async () => {
      const claimed = await handler(req, res);
      if (!claimed) {
        res.writeHead(404);
        res.end("no");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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

describe("im-gateway-sidecar", () => {
  it("reads sidecar config from env", () => {
    const cfg = readImGatewaySidecarConfig({
      XRK_IM_GATEWAY_URL: "http://127.0.0.1:9999",
      XRK_IM_GATEWAY_TOKEN: "secret",
    });
    expect(cfg?.url).toBe("http://127.0.0.1:9999");
    expect(cfg?.token).toBe("secret");
  });

  it("reports sidecar-reachable when upstream health ok", async () => {
    await withUpstream(async (base) => {
      const config = { url: base };
      const probe = await probeImGatewaySidecar(config);
      expect(probe.ok).toBe(true);
      const status = imGatewaySidecarStatusPayload("weixin", config, probe);
      expect(status.state).toBe("sidecar-reachable");
      expect(status.incomplete).toBeUndefined();
    });
  });

  it("gateway health and relay HTTP round-trip", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-gw-http-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withPublicHandler(handler, async (base) => {
      const health = await fetch(`${base}/api/im/gateway/health`);
      const healthBody = (await health.json()) as { ok: boolean; relayPath: string };
      expect(healthBody.ok).toBe(true);
      expect(healthBody.relayPath).toBe("/api/im/gateway/relay");

      const relay = await fetch(`${base}/api/im/gateway/relay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "weixin",
          botId: "b1",
          text: "sidecar relay",
        }),
      });
      expect(relay.status).toBe(200);
      const relayBody = (await relay.json()) as { ok: boolean; mode?: string };
      expect(relayBody.ok).toBe(true);
      expect(relayBody.mode).toBe("sidecar-relay");

      const list = await fetch(`${base}/api/im/weixin/messages?botId=b1`);
      const listBody = (await list.json()) as { messages: unknown[] };
      expect(listBody.messages.length).toBe(1);
    });
  });
});
