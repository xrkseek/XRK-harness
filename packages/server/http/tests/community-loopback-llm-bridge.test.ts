import { describe, expect, it } from "vitest";
import {
  communityLoopbackEndpointFromBits,
  communityLoopbackEndpointFromForwardSettings,
} from "../src/dsh-compat/community-loopback-llm-bridge.js";

describe("communityLoopbackEndpointFromBits", () => {
  it("rejects port 0 but keeps apiKey", () => {
    expect(
      communityLoopbackEndpointFromBits({
        host: "127.0.0.1",
        port: 0,
        apiKey: "k",
      }),
    ).toEqual({ apiKey: "k" });
  });

  it("builds usable loopback baseUrl", () => {
    expect(
      communityLoopbackEndpointFromBits({
        host: "127.0.0.1",
        port: 18899,
        apiKey: "k",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:18899/v1",
      apiKey: "k",
    });
  });
});

describe("communityLoopbackEndpointFromForwardSettings", () => {
  it("prefers actualPort over requested port 0", () => {
    expect(
      communityLoopbackEndpointFromForwardSettings({
        forward: {
          enabled: true,
          running: true,
          host: "127.0.0.1",
          port: 0,
          actualPort: 45678,
        },
        forwardKey: "ofm-key",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:45678/v1",
      apiKey: "ofm-key",
    });
  });

  it("returns empty when forward not running", () => {
    expect(
      communityLoopbackEndpointFromForwardSettings({
        forward: {
          enabled: true,
          running: false,
          host: "127.0.0.1",
          actualPort: 1,
        },
      }),
    ).toEqual({});
  });
});
