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
import {
  createMobileAccessGateHandler,
  createOperatorPinFetchElevator,
} from "../src/dsh-compat/mobile-access-gate.js";
import {
  armAccessGateForListen,
  disposeDesktopLanShare,
  handleMobileAccessHttp,
  injectMobileAccessShellIntoHtml,
  readGateThemePreferenceFromSettingsYaml,
  readMobileAccessState,
  resetDesktopLanShareOnBoot,
  resolveGateThemePreference,
} from "../src/dsh-compat/mobile-access.js";
import {
  isHostOnlyLanIPv4,
  pickPreferredLanIPv4,
  startLanShareGateway,
  stopLanShareGateway,
} from "../src/dsh-compat/mobile-access-lan-share.js";
import { DESKTOP_SHELL_MARK_HEADER } from "../src/dsh-compat/underlying/mobile-gate-kit.js";
import { createDshCompatPublicHandler } from "../src/index.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const temps: string[] = [];
afterEach(async () => {
  await stopLanShareGateway();
  await disposeDesktopLanShare();
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

describe("desktop LAN share gateway", () => {
  it("proxies loopback Host on 0.0.0.0 and control toggles with PIN payload", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-lan-share-"));
    temps.push(home);
    let hits = 0;
    const upstream = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("host-ok");
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", () => resolve()),
    );
    const upAddr = upstream.address();
    if (!upAddr || typeof upAddr === "string") {
      throw new Error("no upstream port");
    }
    const loopback = `http://127.0.0.1:${upAddr.port}`;
    const options = {
      xrkHome: home,
      lanShareEnabled: true as const,
      trustProxy: true as const,
      resolveLoopbackOrigin: () => loopback,
    };
    resetDesktopLanShareOnBoot(options);

    const pinGate = createMobileAccessGateHandler(options);
    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (await pinGate(req, res)) return;
        if (await handleMobileAccessHttp(req, res, url.pathname, options)) {
          return;
        }
        res.writeHead(404);
        res.end();
      })();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no control port");
    const base = `http://127.0.0.1:${addr.port}`;

    // Node fetch rewrites Host from the URL — use httpRequest for LAN Host.
    const offGate = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            method: "GET",
            headers: {
              host: "192.168.9.9:18787",
              accept: "application/json",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(offGate.status).toBe(403);
    expect(JSON.parse(offGate.body) as { error?: string }).toMatchObject({
      error: "desktop_share_disabled",
    });

    // Settings toggle rides Electron Host Fetch (shell mark). Plain 127 is gated once share is on.
    const shellHeaders = {
      "content-type": "application/json",
      [DESKTOP_SHELL_MARK_HEADER]: "1",
    };
    const on = await fetch(`${base}/api/mobile-access/control`, {
      method: "POST",
      headers: shellHeaders,
      body: JSON.stringify({ running: true, lanIp: "127.0.0.1" }),
    });
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as {
      running: boolean;
      desktopLanShare?: boolean;
      origin?: string;
      localOrigin?: string;
      pin?: string;
      sharePort?: number;
    };
    expect(onBody.running).toBe(true);
    expect(onBody.desktopLanShare).toBe(true);
    expect(onBody.pin).toMatch(/^\d{8}$/);
    expect(onBody.origin).toMatch(/^http:\/\//);
    expect(typeof onBody.sharePort).toBe("number");
    expect(onBody.localOrigin).toBe(
      `http://127.0.0.1:${String(onBody.sharePort)}`,
    );

    const started = await startLanShareGateway({
      upstreamOrigin: loopback,
      listenPort: 0,
      lanIp: "127.0.0.1",
    });
    expect(started.localOrigin).toBe(
      `http://127.0.0.1:${String(started.port)}`,
    );
    const viaShare = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: started.port,
          path: "/ping",
          method: "GET",
          headers: { host: `127.0.0.1:${started.port}` },
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
    expect(viaShare).toBe("host-ok");
    expect(hits).toBeGreaterThan(0);

    const needPinWan = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          method: "GET",
          headers: {
            host: "127.0.0.1",
            "x-forwarded-host": "demo.r6.cpolar.cn",
            accept: "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(needPinWan.status).toBe(401);

    // Share proxy rewrites Host→loopback and sets LAN XFH — must still require PIN.
    const needPinLan = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          method: "GET",
          headers: {
            host: "127.0.0.1",
            "x-forwarded-host": "10.205.40.186:8787",
            accept: "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(needPinLan.status).toBe(401);

    // Share ON + Host=127 without shell mark → PIN (内穿 / curl 到本机分享口).
    const needPinLoopback = await new Promise<{ status: number }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            method: "GET",
            headers: {
              host: "127.0.0.1",
              accept: "application/json",
            },
          },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0 });
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(needPinLoopback.status).toBe(401);

    const off = await fetch(`${base}/api/mobile-access/control`, {
      method: "POST",
      headers: shellHeaders,
      body: JSON.stringify({ running: false }),
    });
    expect(off.status).toBe(200);
    expect((await off.json() as { running: boolean }).running).toBe(false);

    await stopLanShareGateway();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});

describe("pickPreferredLanIPv4", () => {
  it("skips VirtualBox host-only when a real Wi-Fi IP exists", () => {
    expect(isHostOnlyLanIPv4("192.168.56.1")).toBe(true);
    expect(isHostOnlyLanIPv4("192.168.1.8")).toBe(false);
    expect(
      pickPreferredLanIPv4(["192.168.56.1", "192.168.1.8"]),
    ).toBe("192.168.1.8");
    expect(pickPreferredLanIPv4(["192.168.56.1"])).toBe("192.168.56.1");
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
