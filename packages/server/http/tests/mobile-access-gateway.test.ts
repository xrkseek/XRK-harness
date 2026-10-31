/**
 * Local mobile gateway — HTTP + WebSocket upgrade forwarding.
 */
import { createServer, request as httpRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { startLocalProxyGateway } from "../src/dsh-compat/mobile-access-local-gateway.js";
import {
  accessPinCookieDigest,
  buildPinPageHtml,
  gateThemeBootScript,
  WAN_PIN_COOKIE,
} from "../src/dsh-compat/mobile-access-auth.js";
import { createOperatorPinFetchElevator } from "../src/dsh-compat/mobile-access-gate.js";
import {
  armAccessGateForListen,
  injectMobileAccessShellIntoHtml,
  readGateThemePreferenceFromSettingsYaml,
  readMobileAccessState,
  resolveGateThemePreference,
} from "../src/dsh-compat/mobile-access.js";
import { createDshCompatPublicHandler } from "../src/index.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("mobile-access-local-gateway", () => {
  it("forwards HTTP and WebSocket upgrades with forwarded host", async () => {
    let sawForwardedHost = "";
    let sawUpgrade = false;
    const upstream = createServer((req, res) => {
      sawForwardedHost = String(req.headers["x-forwarded-host"] ?? "");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok-http");
    });
    upstream.on("upgrade", (req, socket) => {
      sawUpgrade = true;
      sawForwardedHost = String(req.headers["x-forwarded-host"] ?? "");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.write("ws-ok");
      socket.end();
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", () => resolve()),
    );
    const upAddr = upstream.address();
    if (!upAddr || typeof upAddr === "string") {
      throw new Error("no upstream port");
    }

    const gateway = await startLocalProxyGateway({
      upstreamUrl: `http://127.0.0.1:${upAddr.port}`,
      publicOrigin: "https://demo.r6.cpolar.cn",
    });
    const gw = gateway.address();

    const httpBody = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: gw.port,
          path: "/ping",
          method: "GET",
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(httpBody).toBe("ok-http");
    expect(sawForwardedHost).toBe("demo.r6.cpolar.cn");

    const wsPayload = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: gw.port,
        path: "/api/events.mux",
        method: "GET",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });
      req.on("upgrade", (_res, socket, head) => {
        const chunks: Buffer[] = [Buffer.from(head)];
        socket.on("data", (c) => chunks.push(c as Buffer));
        socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        socket.on("error", reject);
        if (socket.readableEnded) {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });
      req.on("error", reject);
      req.on("response", () => reject(new Error("expected upgrade")));
      req.end();
    });
    expect(sawUpgrade).toBe(true);
    expect(wsPayload).toContain("ws-ok");
    expect(sawForwardedHost).toBe("demo.r6.cpolar.cn");

    await gateway.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});

describe("createOperatorPinFetchElevator", () => {
  it("accepts only HttpOnly PIN digests, never the SPA UI marker", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-pin-elev-"));
    temps.push(home);
    const options = { xrkHome: home };
    const armed = armAccessGateForListen(options, "10.0.0.2", 8099);
    expect(armed.armed).toBe(true);
    const state = readMobileAccessState(options);
    const elev = createOperatorPinFetchElevator(options);

    expect(
      elev(
        new Request("http://example.com/api/x", {
          headers: { cookie: "xrk_operator_ui=1" },
        }),
      ),
    ).toBe(false);

    const digest = accessPinCookieDigest(state.wanToken, state.instanceId);
    expect(
      elev(
        new Request("http://example.com/api/x", {
          headers: { cookie: `${WAN_PIN_COOKIE}=${digest}` },
        }),
      ),
    ).toBe(true);
  });
});

describe("mobile-access wan pin cookie", () => {
  it("unlocks gated requests after wan-pin auth", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-wan-pin-"));
    temps.push(home);
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-wan-pin-pl-"));
    temps.push(pluginsDir);
    mkdirSync(path.join(pluginsDir, "web", "plugins"), { recursive: true });
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({ rev: 1, packages: {} }),
    );

    const handler = createDshCompatPublicHandler({
      pluginsDir,
      xrkHome: home,
      // Tests simulate a reverse-proxy WAN hop via X-Forwarded-Host.
      trustProxy: true,
    });
    const server = createServer(async (req, res) => {
      const claimed = await handler(req, res);
      if (!claimed && !res.writableEnded) {
        res.writeHead(404);
        res.end("nf");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${addr.port}`;

    await fetch(`${base}/api/mobile-access/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ running: true }),
    });
    const state = readMobileAccessState({ xrkHome: home });
    expect(state.wanToken).toMatch(/^\d{8}$/);

    const blocked = await fetch(`${base}/api/mobile-access/control`, {
      headers: {
        "x-forwarded-host": "demo.r6.cpolar.cn",
        Accept: "application/json",
      },
    });
    expect(blocked.status).toBe(401);

    const pinRes = await fetch(`${base}/mobile-access/auth/wan-pin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-host": "demo.r6.cpolar.cn",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ pin: state.wanToken }),
    });
    expect(pinRes.status).toBe(200);
    const setCookie = pinRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
    expect(cookieHeader).toContain("dsh_ma_wan=");
    expect(cookieHeader).toContain("xrk_operator_ui=1");

    // SPA UX marker alone must never unlock Host (keys / settings / control).
    const forgedUi = await fetch(`${base}/api/mobile-access/control`, {
      headers: {
        "x-forwarded-host": "demo.r6.cpolar.cn",
        Accept: "application/json",
        cookie: "xrk_operator_ui=1",
      },
    });
    expect(forgedUi.status).toBe(401);

    const unlocked = await fetch(`${base}/api/mobile-access/control`, {
      headers: {
        "x-forwarded-host": "demo.r6.cpolar.cn",
        Accept: "application/json",
        cookie: cookieHeader,
      },
    });
    expect(unlocked.status).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe("injectMobileAccessShellIntoHtml", () => {
  it("injects custom.css link once", () => {
    const html = "<html><head><title>t</title></head><body></body></html>";
    const once = injectMobileAccessShellIntoHtml(html);
    expect(once).toContain('href="/mobile-access/custom.css"');
    expect(injectMobileAccessShellIntoHtml(once)).toBe(once);
  });
});

describe("PIN gate theme preference", () => {
  it("stamps durable Settings preference into the boot script", () => {
    expect(gateThemeBootScript("dark")).toContain('preference = "dark"');
    expect(gateThemeBootScript("light")).toContain('preference = "light"');
    expect(buildPinPageHtml("wan", "dark")).toContain('preference = "dark"');
    expect(buildPinPageHtml("lan", "light")).toContain('preference = "light"');
  });

  it("parses ui-theme.preference from settings.yaml", () => {
    expect(
      readGateThemePreferenceFromSettingsYaml(
        "locale:\n  preference: zh\nui-theme:\n  preference: dark\n",
      ),
    ).toBe("dark");
    expect(
      readGateThemePreferenceFromSettingsYaml("ui-theme:\n  fontSize: 13\n"),
    ).toBeUndefined();
  });

  it("resolves Face callback over yaml over system", () => {
    expect(
      resolveGateThemePreference({
        getThemePreference: () => "light",
        xrkHome: "/missing",
      }),
    ).toBe("light");

    const home = mkdtempSync(path.join(tmpdir(), "xrk-gate-theme-"));
    temps.push(home);
    writeFileSync(
      path.join(home, "settings.yaml"),
      "ui-theme:\n  preference: dark\n",
      "utf8",
    );
    expect(resolveGateThemePreference({ xrkHome: home })).toBe("dark");
    expect(resolveGateThemePreference({})).toBe("system");
  });
});
