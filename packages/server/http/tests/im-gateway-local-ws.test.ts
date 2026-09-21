import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachDshCompatUpgrades, resetDshCompatUpgrades } from "../src/dsh-compat/dsh-compat-upgrades.js";
import {
  configureImGatewayLocalWs,
  IM_GATEWAY_LOCAL_WS_PATH,
} from "../src/dsh-compat/im-gateway-local-ws.js";
import { listImMessages } from "../src/dsh-compat/im-messaging-bridge.js";
import { imLongLivedGatewayStatus } from "../src/dsh-compat/im-long-lived-gateway.js";

const temps: string[] = [];

afterEach(() => {
  resetDshCompatUpgrades();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("im local ws ingress without gateway env", () => {
  it("keeps bridge status and a local ws path when env is empty", () => {
    const status = imLongLivedGatewayStatus("weixin", {});
    expect(status.state).toBe("bridge");
    expect(status.localWsPath).toBe(IM_GATEWAY_LOCAL_WS_PATH);
    expect(status.incomplete).toBeUndefined();
  });

  it("ingests a text frame on /api/im/gateway/ws", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-local-ws-"));
    temps.push(home);
    resetDshCompatUpgrades();
    configureImGatewayLocalWs({ xrkHome: home, env: {} });

    const server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const closer = attachDshCompatUpgrades(server, { checkAuth: () => true });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    try {
      const ws = new WebSocket(
        `ws://127.0.0.1:${addr.port}${IM_GATEWAY_LOCAL_WS_PATH}`,
      );
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => {
          ws.send(
            JSON.stringify({
              channel: "weixin",
              botId: "b1",
              text: "local push",
            }),
          );
          setTimeout(() => {
            ws.close();
            resolve();
          }, 50);
        });
        ws.addEventListener("error", () => reject(new Error("ws error")));
      });

      const listed = listImMessages(home, "weixin", { botId: "b1" }) as {
        messages: Array<{ text: string }>;
      };
      expect(listed.messages.some((row) => row.text === "local push")).toBe(true);
    } finally {
      closer.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
