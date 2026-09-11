import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DESKTOP_HOST_PROTOCOL_VERSION } from "../src/host-protocol.js";
import { DesktopHostProcess } from "../src/host-process.js";

const roots: string[] = [];

const HOST_WIRE = `
import { closeSync, createReadStream, createWriteStream } from 'node:fs'
const requestPipe = createReadStream('', { fd: 3, autoClose: false })
const responsePipe = createWriteStream('', { fd: 4, autoClose: false })
const MAGIC = 0x58524b31
const HEADER = 13
function responseFrame(type, streamId, payload = Buffer.alloc(0)) {
  const frame = Buffer.allocUnsafe(HEADER + payload.length)
  frame.writeUInt32BE(MAGIC, 0)
  frame.writeUInt8(type, 4)
  frame.writeUInt32BE(streamId, 5)
  frame.writeUInt32BE(payload.length, 9)
  payload.copy(frame, HEADER)
  return frame
}
function responseStart(streamId, options = {}) {
  const value = { status: options.status ?? 200, headers: options.headers ?? [], hasBody: options.hasBody ?? true }
  responsePipe.write(responseFrame(1, streamId, Buffer.from(JSON.stringify(value))))
}
function responseData(streamId, data) {
  responsePipe.write(responseFrame(2, streamId, Buffer.from(data)))
}
function responseEnd(streamId) { responsePipe.write(responseFrame(3, streamId)) }
let requestBuffer = Buffer.alloc(0)
requestPipe.on('data', chunk => {
  requestBuffer = requestBuffer.length === 0 ? chunk : Buffer.concat([requestBuffer, chunk])
  while (requestBuffer.length >= HEADER) {
    if (requestBuffer.readUInt32BE(0) !== MAGIC) throw new Error('invalid request marker')
    const type = requestBuffer.readUInt8(4)
    const streamId = requestBuffer.readUInt32BE(5)
    const length = requestBuffer.readUInt32BE(9)
    if (requestBuffer.length < HEADER + length) return
    const payload = requestBuffer.subarray(HEADER, HEADER + length)
    requestBuffer = requestBuffer.subarray(HEADER + length)
    onRequestFrame({ type, streamId, payload })
  }
})
process.on('message', message => {
  if (message.type === 'shutdown') {
    requestPipe.destroy()
    closeSync(3)
    responsePipe.end(() => {
      responsePipe.destroy()
      closeSync(4)
      process.disconnect()
      process.exitCode = 0
    })
  }
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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop host process", () => {
  it("spawns Node, carries Fetch bytes on pipes, and shuts down cleanly", async () => {
    const { project, entry } = projectWithHost(`
const bodies = new Map()
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, hostVersion: process.env.NODE_OPTIONS ?? 'clean' })
function onRequestFrame(frame) {
  if (frame.type === 1) {
    const request = JSON.parse(frame.payload)
    bodies.set(frame.streamId, Buffer.alloc(0))
    if (!request.hasBody) answer(frame.streamId)
  } else if (frame.type === 2) {
    bodies.set(frame.streamId, Buffer.concat([bodies.get(frame.streamId), frame.payload]))
  } else if (frame.type === 3) {
    answer(frame.streamId)
  }
}
function answer(streamId) {
  responseStart(streamId, { headers: [['content-type', 'text/plain']] })
  responseData(streamId, Buffer.concat([Buffer.from('desktop:'), bodies.get(streamId)]))
  responseEnd(streamId)
}
`);
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require /path/that-must-not-reach-the-child";
    const host = new DesktopHostProcess(process.execPath, project, { entry });
    try {
      await expect(host.start()).resolves.toMatchObject({
        protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        hostVersion: "clean",
      });
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
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
      await host.stop().catch(() => undefined);
    }
  });

  it("stops an unfinished upload when the Host completes its response early", async () => {
    const { project, entry } = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, hostVersion: 'early-response' })
function onRequestFrame(frame) {
  if (frame.type !== 2) return
  responseStart(frame.streamId)
  responseData(frame.streamId, 'accepted')
  responseEnd(frame.streamId)
}
`);
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("first"));
      },
      cancel() {
        canceled = true;
      },
    });
    const host = new DesktopHostProcess(process.execPath, project, { entry });
    try {
      const request = new Request("xrk-app://app/early", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const response = await host.fetch(request);
      await expect(response.text()).resolves.toBe("accepted");
      await expect.poll(() => canceled).toBe(true);
    } finally {
      await host.stop().catch(() => undefined);
    }
  });

  it("cancels a response stream without breaking a later fetch", async () => {
    const { project, entry } = projectWithHost(`
process.send({ type: 'ready', protocolVersion: ${String(DESKTOP_HOST_PROTOCOL_VERSION)}, hostVersion: 'cancel-race' })
const urls = new Map()
function onRequestFrame(frame) {
  if (frame.type === 1) {
    const request = JSON.parse(frame.payload)
    urls.set(frame.streamId, request.url)
    responseStart(frame.streamId)
    if (request.url.endsWith('/after')) {
      responseData(frame.streamId, 'alive')
      responseEnd(frame.streamId)
    }
  } else if (frame.type === 4 && urls.get(frame.streamId).endsWith('/cancel')) {
    responseEnd(frame.streamId)
  }
}
`);
    const host = new DesktopHostProcess(process.execPath, project, { entry });
    try {
      const canceled = await host.fetch(new Request("xrk-app://app/cancel"));
      await canceled.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const after = await host.fetch(new Request("xrk-app://app/after"));
      await expect(after.text()).resolves.toBe("alive");
    } finally {
      await host.stop().catch(() => undefined);
    }
  });
});
