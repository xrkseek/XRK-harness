import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_HOST_PROTOCOL_VERSION } from "../src/host-protocol.js";
import { DesktopHostProcess } from "../src/host-process.js";

const roots: string[] = [];

/** Minimal loopback Host stub — IPC ready(+origin) + HTTP Face (no Face pipes). */
const HOST_WIRE = `
import { createServer } from 'node:http'
let server
function listenAndReady(hostVersion, onRequest) {
  server = createServer(onRequest)
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    const origin = 'http://127.0.0.1:' + String(addr.port)
    process.send({
      type: 'ready',
      protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)},
      hostVersion,
      origin,
    })
  })
}
process.on('message', message => {
  if (message.type !== 'shutdown') return
  const done = () => {
    try { process.disconnect() } catch {}
    process.exit(0)
  }
  if (server === undefined) { done(); return }
  server.close(() => done())
})
`;

function projectWithHost(source: string): { project: string; entry: string } {
  const project = mkdtempSync(join(tmpdir(), "xrk-desktop-host-test-"));
  roots.push(project);
  const packageRoot = join(
    project,
    "node_modules",
    "@xrkseek",
    "harness-desktop-host",
  );
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    '{"name":"@xrkseek/harness-desktop-host","type":"module"}\n',
  );
  const entry = join(packageRoot, "dist", "index.js");
  writeFileSync(entry, `${HOST_WIRE}\n${source}`);
  return { project, entry };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Child may still hold the temp dir briefly on Windows.
    }
  }
});

describe("desktop host process", () => {
  it("spawns Node, reports loopback origin, Fetch, and shuts down cleanly", async () => {
    const { project, entry } = projectWithHost(`
listenAndReady(
  process.env.NODE_OPTIONS ?? (process.env.ELECTRON_RUN_AS_NODE !== undefined ? 'electron-leak' : 'clean'),
  async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(Buffer.concat([Buffer.from('desktop:'), body]))
  },
)
`);
    const previousNodeOptions = process.env.NODE_OPTIONS;
    const previousElectron = process.env.ELECTRON_RUN_AS_NODE;
    process.env.NODE_OPTIONS = "--require /path/that-must-not-reach-the-child";
    process.env.ELECTRON_RUN_AS_NODE = "1";
    const host = new DesktopHostProcess(process.execPath, project, { entry });
    try {
      const ready = await host.start();
      expect(ready).toMatchObject({
        protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        hostVersion: "clean",
      });
      expect(ready.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(host.faceOrigin).toBe(ready.origin);
      const response = await host.fetch(
        new Request("xrk-app://app/example", {
          method: "POST",
          body: "request",
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("desktop:request");
      await expect(host.stop()).resolves.toBeUndefined();
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      if (previousElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = previousElectron;
      await host.stop().catch(() => undefined);
    }
  });

  it("serves SSE headers and a sibling unary on the loopback Face", async () => {
    const { project, entry } = projectWithHost(`
listenAndReady('sse-unary', (req, res) => {
  if ((req.url ?? '').includes('events.mux')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(': connected\\n\\n')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end('{"ok":true}')
})
`);
    const host = new DesktopHostProcess(process.execPath, project, { entry });
    try {
      const muxAbort = new AbortController();
      const mux = await host.fetch(
        new Request("xrk-app://stream/api/events.mux", {
          signal: muxAbort.signal,
        }),
      );
      expect(mux.headers.get("content-type")).toContain("text/event-stream");
      // Abort the long-lived stream so the test process can exit cleanly.
      muxAbort.abort();
      await mux.body?.cancel().catch(() => undefined);
      const describe = await host.fetch(
        new Request("xrk-app://app/api/host.describe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(describe.status).toBe(200);
      await expect(describe.text()).resolves.toBe('{"ok":true}');
    } finally {
      await host.stop().catch(() => undefined);
    }
  }, 15_000);

  it("treats IPC disconnect as Host death so waitForExit can restart", async () => {
    const { project, entry } = projectWithHost(`
listenAndReady('orphan-ipc', (_req, res) => {
  res.writeHead(200)
  res.end('ok')
})
setInterval(() => {}, 60_000)
process.on('message', (message) => {
  if (message.type === 'drop-ipc') process.disconnect()
})
`);
    const host = new DesktopHostProcess(process.execPath, project, { entry });
    await host.start();
    const child = (
      host as unknown as { child?: { send: (msg: unknown) => void } }
    ).child;
    expect(child).toBeDefined();
    const exited = host.waitForExit();
    child!.send({ type: "drop-ipc" });
    await expect(
      Promise.race([
        exited.then(() => "exited"),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("timeout"), 8_000);
        }),
      ]),
    ).resolves.toBe("exited");
    await expect(
      host.fetch(new Request("xrk-app://app/after-disconnect")),
    ).rejects.toThrow(/unavailable|disconnected|stopped/i);
  });

  it("rejects ready without a loopback origin", async () => {
    const project = mkdtempSync(join(tmpdir(), "xrk-desktop-host-bad-ready-"));
    roots.push(project);
    const packageRoot = join(
      project,
      "node_modules",
      "@xrkseek",
      "harness-desktop-host",
    );
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      '{"name":"@xrkseek/harness-desktop-host","type":"module"}\n',
    );
    const entry = join(packageRoot, "dist", "index.js");
    writeFileSync(
      entry,
      `process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, hostVersion: 'no-origin' })
setInterval(() => {}, 60_000)
process.on('message', (m) => { if (m.type === 'shutdown') { process.disconnect(); process.exit(0) } })
`,
    );
    const host = new DesktopHostProcess(process.execPath, project, {
      entry,
      readyTimeoutMs: 5_000,
    });
    await expect(host.start()).rejects.toThrow(/invalid IPC event/i);
    await host.stop().catch(() => undefined);
  });
});
