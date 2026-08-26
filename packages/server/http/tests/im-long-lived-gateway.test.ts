import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleImChannelRpc } from "../src/dsh-compat/im-channels.js";
import {
  IM_GATEWAY_VENDORS,
  imLongLivedGatewayStatus,
} from "../src/dsh-compat/im-long-lived-gateway.js";
import {
  readImVendorWsUrl,
  stopImVendorWsClient,
} from "../src/dsh-compat/im-vendor-ws-client.js";

const temps: string[] = [];

afterEach(() => {
  stopImVendorWsClient();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("im-long-lived-gateway", () => {
  it("reports bridge mode with webhook/poll paths by default", () => {
    const status = imLongLivedGatewayStatus("weixin");
    expect(status.ok).toBe(true);
    expect(status.state).toBe("bridge");
    expect(status.incomplete).toBeUndefined();
    const bridge = status.bridge as Record<string, string>;
    expect(bridge.webhook).toBe("/api/im/weixin/webhook");
    expect(bridge.poll).toBe("/api/im/weixin/stream");
    expect(IM_GATEWAY_VENDORS).toContain("weixin");
  });

  it("routes connection.gateway.connect in bridge mode when no env", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-gw-"));
    temps.push(home);

    const status = handleImChannelRpc(
      "/feishu",
      "connection.gateway.status",
      {},
      { xrkHome: home },
    ) as { ok?: boolean; state?: string };
    expect(status.ok).toBe(true);
    expect(status.state).toBe("bridge");

    const connect = handleImChannelRpc(
      "/feishu",
      "connection.gateway.connect",
      { botId: "b1" },
      { xrkHome: home },
    ) as { ok?: boolean; mode?: string };
    expect(connect.ok).toBe(true);
    expect(connect.mode).toBe("bridge");
  });

  it("derives ws url from XRK_IM_GATEWAY_URL", () => {
    expect(
      readImVendorWsUrl({
        XRK_IM_GATEWAY_URL: "http://127.0.0.1:8787",
      }),
    ).toBe("ws://127.0.0.1:8787/ws");
  });

  it("connect starts ws-client mode when ws env set", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-gw-ws-"));
    temps.push(home);
    const prev = process.env.XRK_IM_GATEWAY_WS_URL;
    process.env.XRK_IM_GATEWAY_WS_URL = "ws://127.0.0.1:9001/ws";
    vi.stubGlobal(
      "WebSocket",
      class {
        readyState = 1;
        close() {}
        send() {}
        addEventListener() {}
      },
    );
    try {
      const connect = handleImChannelRpc(
        "/telegram",
        "connection.gateway.connect",
        {},
        { xrkHome: home },
      ) as { ok?: boolean; mode?: string };
      expect(connect.ok).toBe(true);
      expect(connect.mode).toBe("ws-client");
    } finally {
      if (prev === undefined) delete process.env.XRK_IM_GATEWAY_WS_URL;
      else process.env.XRK_IM_GATEWAY_WS_URL = prev;
      vi.unstubAllGlobals();
    }
  });
});
