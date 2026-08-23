import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  attachDshCompatUpgrades,
  listDshCompatUpgradePaths,
  registerDshCompatUpgrade,
  resetDshCompatUpgrades,
} from "../src/dsh-compat/dsh-compat-upgrades.js";

function mockUpgradeSocket(): Duplex & {
  written: string;
  destroyed: boolean;
} {
  const socket = new Duplex({
    read() {
      /* no upstream */
    },
    write(chunk, _enc, cb) {
      socket.written += String(chunk);
      cb();
    },
  }) as Duplex & { written: string; destroyed: boolean };
  socket.written = "";
  socket.destroyed = false;
  const origDestroy = socket.destroy.bind(socket);
  socket.destroy = ((...args: unknown[]) => {
    socket.destroyed = true;
    return origDestroy(...(args as []));
  }) as typeof socket.destroy;
  return socket;
}

function mockUpgradeReq(pathname: string): IncomingMessage {
  return { url: pathname, method: "GET" } as IncomingMessage;
}

describe("dsh-compat-upgrades", () => {
  it("dedupes routes by normalized path", () => {
    resetDshCompatUpgrades();
    registerDshCompatUpgrade({ path: "/ws/foo" });
    registerDshCompatUpgrade({ path: "/ws/foo/" });
    expect(listDshCompatUpgradePaths()).toEqual(["/ws/foo"]);
  });

  it("honest 501 when route has no handler", () => {
    resetDshCompatUpgrades();
    registerDshCompatUpgrade({ path: "/ws/stub" });

    const server = createServer();
    const closer = attachDshCompatUpgrades(server, {
      checkAuth: () => true,
    });
    const onUpgrade = server.listeners("upgrade").at(-1) as (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => void;

    const socket = mockUpgradeSocket();
    onUpgrade(mockUpgradeReq("/ws/stub"), socket, Buffer.alloc(0));
    expect(socket.written).toContain("501");
    expect(socket.written).toContain("dsh-host");
    expect(socket.destroyed).toBe(true);
    closer.close();
  });

  it("delegates to custom handler when provided", () => {
    resetDshCompatUpgrades();
    let called = false;
    registerDshCompatUpgrade({
      path: "/ws/custom",
      handler: () => {
        called = true;
      },
    });

    const server = createServer();
    const closer = attachDshCompatUpgrades(server, {
      checkAuth: () => true,
    });
    const onUpgrade = server.listeners("upgrade").at(-1) as (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => void;

    const socket = mockUpgradeSocket();
    onUpgrade(mockUpgradeReq("/ws/custom"), socket, Buffer.alloc(0));
    expect(called).toBe(true);
    closer.close();
  });

  it("returns 401 when checkAuth fails", () => {
    resetDshCompatUpgrades();
    registerDshCompatUpgrade({ path: "/ws/auth" });

    const server = createServer();
    const closer = attachDshCompatUpgrades(server, {
      checkAuth: () => false,
    });
    const onUpgrade = server.listeners("upgrade").at(-1) as (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => void;

    const socket = mockUpgradeSocket();
    onUpgrade(mockUpgradeReq("/ws/auth"), socket, Buffer.alloc(0));
    expect(socket.written).toContain("401");
    expect(socket.destroyed).toBe(true);
    closer.close();
  });
});
