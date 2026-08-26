import { describe, expect, it } from "vitest";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { buildFaceChannelDiscover, FACE_IM_CHANNEL_STUBS, resolveImGatewayWired } from "../src/process-channels.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

describe("processChannels discover (C-2)", () => {
  it("lists kind:channel plugin rows and IM vendor stubs", () => {
    const payload = buildFaceChannelDiscover([
      {
        id: "im-stub",
        kind: "channel",
        channels: [{ channelId: "custom-bot", displayName: "Custom Bot" }],
      },
    ]);
    expect(payload.process).toEqual([
      {
        pluginId: "im-stub",
        channelId: "custom-bot",
        displayName: "Custom Bot",
        source: "plugin",
        wired: true,
      },
    ]);
    expect(payload.im.length).toBe(FACE_IM_CHANNEL_STUBS.length);
    expect(payload.im.some((row) => row.channelId === "slack")).toBe(true);
    expect(payload.im[0]?.wired).toBe("bridge");
  });

  it("marks IM vendors sidecar when gateway env is configured", () => {
    const payload = buildFaceChannelDiscover([], { imSidecarConfigured: true });
    expect(payload.im[0]?.wired).toBe("sidecar");
    expect(payload.im[0]?.gatewayRelayPath).toBe("/api/im/gateway/relay");
    expect(payload.note).toContain("XRK_IM_GATEWAY_URL");
  });

  it("marks IM vendors ws-client when XRK_IM_GATEWAY_WS_URL is set", () => {
    const prev = process.env.XRK_IM_GATEWAY_WS_URL;
    process.env.XRK_IM_GATEWAY_WS_URL = "ws://127.0.0.1:8788/ws";
    try {
      expect(resolveImGatewayWired()).toBe("ws-client");
      const payload = buildFaceChannelDiscover([]);
      expect(payload.im[0]?.wired).toBe("ws-client");
      expect(payload.note).toContain("XRK_IM_GATEWAY_WS_URL");
    } finally {
      if (prev === undefined) delete process.env.XRK_IM_GATEWAY_WS_URL;
      else process.env.XRK_IM_GATEWAY_WS_URL = prev;
    }
  });

  it("processChannels/list RPC returns discover payload", async () => {
    const runtime = createBareFaceRuntime({
      plugins: [
        {
          id: "chan-a",
          kind: "channel",
          channels: [{ channelId: "webhook" }],
        },
      ],
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
      },
    });
    const res = await dispatchFaceMethod(
      runtime,
      "processChannels/list",
      "pc1",
      {},
    );
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("list");
    const value = res.result.value as ReturnType<typeof buildFaceChannelDiscover>;
    expect(value.process[0]?.channelId).toBe("webhook");
    expect(value.im.length).toBeGreaterThan(0);
  });

  it("settings.describe includes process-channels namespace when hostPublic set", async () => {
    const runtime = createBareFaceRuntime({
      plugins: [
        {
          id: "chan-b",
          kind: "channel",
          channels: [{ channelId: "teams", displayName: "Teams" }],
        },
      ],
      hostPublic: {
        host: "127.0.0.1",
        port: 8787,
        workspaceRoot: "/tmp",
        preset: "harness",
        corsOrigin: "*",
        rateLimitPerMinute: 60,
        webDistConfigured: true,
      },
    });
    const res = await dispatchFaceMethod(runtime, "settings.describe", "sd1", {});
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("describe");
    const namespaces = (
      res.result.value as { namespaces: Array<{ ns: string; value: unknown }> }
    ).namespaces;
    const row = namespaces.find((n) => n.ns === "process-channels");
    expect(row?.value).toMatchObject({
      process: [{ pluginId: "chan-b", channelId: "teams" }],
    });
  });
});
