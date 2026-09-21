/** Live host-plugin HTTP chain follows register/unregister without restart. */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createLiveHostPluginsPublicHandler } from "../src/host-wire.js";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

function fakeRes(): { res: ServerResponse; body: string } {
  let body = "";
  const res = {
    writeHead() {
      return this;
    },
    end(chunk?: string) {
      body += chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    get body() {
      return body;
    },
  };
}

describe("createLiveHostPluginsPublicHandler", () => {
  it("drops a route after unregister and restores it after register", async () => {
    const plugins: RegisteredPlugin[] = [];
    const handler = createLiveHostPluginsPublicHandler(
      () => plugins,
      {},
    );
    const plugin = (id: string): RegisteredPlugin => ({
      id,
      kind: "host",
      createPublicHandler: () => (req, res) => {
        const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        if (path !== "/paired") return false;
        res.writeHead(200);
        res.end(id);
        return true;
      },
    });

    const req = { method: "GET", url: "/paired" } as IncomingMessage;
    const first = fakeRes();
    expect(await handler(req, first.res)).toBe(false);

    plugins.push(plugin("alpha"));
    const second = fakeRes();
    expect(await handler(req, second.res)).toBe(true);
    expect(second.body).toBe("alpha");

    plugins.pop();
    const third = fakeRes();
    expect(await handler(req, third.res)).toBe(false);

    plugins.push(plugin("beta"));
    const fourth = fakeRes();
    expect(await handler(req, fourth.res)).toBe(true);
    expect(fourth.body).toBe("beta");
  });
});
