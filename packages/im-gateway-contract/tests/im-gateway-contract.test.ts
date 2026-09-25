import { describe, expect, it } from "vitest";
import {
  IM_GATEWAY_CONTRACT_VERSION,
  IM_GATEWAY_ENV_TOKEN,
  IM_GATEWAY_ENV_URL,
  assertRelayAuthorized,
  imGatewayStateFromProbe,
  interpretSidecarHealthBody,
  parseRelayBody,
  readImGatewaySidecarConfig,
  sidecarHealthResponse,
} from "../src/index.js";

describe("im-gateway-contract", () => {
  it("reads env config", () => {
    expect(
      readImGatewaySidecarConfig({
        [IM_GATEWAY_ENV_URL]: " http://127.0.0.1:9 ",
        [IM_GATEWAY_ENV_TOKEN]: " secret ",
      }),
    ).toEqual({ url: "http://127.0.0.1:9", token: "secret" });
    expect(readImGatewaySidecarConfig({})).toBeUndefined();
  });

  it("parses relay bodies and rejects missing channel", () => {
    expect(parseRelayBody({ channel: " mock ", text: "hi", botId: "b1" })).toEqual({
      ok: true,
      body: { channel: "mock", text: "hi", botId: "b1" },
    });
    expect(parseRelayBody({ text: "nope" }).ok).toBe(false);
    expect(parseRelayBody(null).ok).toBe(false);
  });

  it("authorizes loopback without token and bearer with token", () => {
    expect(
      assertRelayAuthorized({
        hostHeader: "127.0.0.1:9460",
        authorization: undefined,
        gatewayTokenHeader: undefined,
        config: { url: "http://sidecar" },
      }).ok,
    ).toBe(true);
    expect(
      assertRelayAuthorized({
        hostHeader: "evil.example",
        authorization: undefined,
        gatewayTokenHeader: undefined,
        config: { url: "http://sidecar" },
      }).ok,
    ).toBe(false);
    expect(
      assertRelayAuthorized({
        hostHeader: "evil.example",
        authorization: "Bearer tok",
        gatewayTokenHeader: undefined,
        config: { url: "http://sidecar", token: "tok" },
      }).ok,
    ).toBe(true);
    expect(
      assertRelayAuthorized({
        hostHeader: "evil.example",
        authorization: undefined,
        gatewayTokenHeader: "tok",
        config: { url: "http://sidecar", token: "tok" },
      }).ok,
    ).toBe(true);
  });

  it("maps health body + state enum", () => {
    expect(interpretSidecarHealthBody(sidecarHealthResponse(), true)).toEqual({
      ok: true,
      status: "ok",
      contractVersion: IM_GATEWAY_CONTRACT_VERSION,
    });
    expect(imGatewayStateFromProbe(undefined)).toBe("bridge");
    expect(imGatewayStateFromProbe({ url: "http://x" })).toBe(
      "sidecar-configured",
    );
    expect(
      imGatewayStateFromProbe({ url: "http://x" }, { ok: true, status: "ok" }),
    ).toBe("sidecar-reachable");
    expect(
      imGatewayStateFromProbe({ url: "http://x" }, { ok: false, error: "down" }),
    ).toBe("sidecar-unreachable");
  });

  it("probeImGatewaySidecar hits /health", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(sidecarHealthResponse()));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const { probeImGatewaySidecar } = await import("../src/index.js");
      const probe = await probeImGatewaySidecar({
        url: `http://127.0.0.1:${port}`,
      });
      expect(probe.ok).toBe(true);
      expect(probe.contractVersion).toBe(IM_GATEWAY_CONTRACT_VERSION);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
