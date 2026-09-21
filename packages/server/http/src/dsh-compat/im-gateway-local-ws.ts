/**
 * Host-local IM push ingress. Works with no XRK_IM_GATEWAY_* env.
 * Clients open `/api/im/gateway/ws` and send JSON text frames; rows land in
 * the same store as webhook / relay. Vendor dial-out stays optional env.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { registerDshCompatUpgrade } from "./dsh-compat-upgrades.js";
import { ingestImWebhook } from "./im-messaging-bridge.js";

export const IM_GATEWAY_LOCAL_WS_PATH = "/api/im/gateway/ws";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const ingress: { xrkHome?: string; env: NodeJS.ProcessEnv } = {
  env: process.env,
};

function isLocalHost(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? "");
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
}

function pushAuthorized(req: IncomingMessage, env: NodeJS.ProcessEnv): boolean {
  const expected = env.XRK_IM_GATEWAY_TOKEN?.trim();
  if (!expected) return isLocalHost(req);
  const header = String(req.headers["x-im-gateway-token"] ?? "");
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return header === expected || url.searchParams.get("token") === expected;
}

function writeFrame(socket: Duplex, opcode: number, payload: Buffer): void {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function ingestText(raw: string, xrkHome: string | undefined): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const record = parsed as Record<string, unknown>;
  const channel = String(record.channel ?? record.vendor ?? "").trim();
  if (!channel) return;
  const botId = typeof record.botId === "string" ? record.botId : undefined;
  ingestImWebhook(xrkHome, channel, record, botId);
}

/** Pull complete client frames. Returns the unconsumed tail. */
export function consumeImGatewayWsFrames(
  buf: Buffer,
  socket: Duplex,
  onText: (text: string) => void,
): Buffer {
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset]!;
    const b1 = buf[offset + 1]!;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let header = 2;
    if (len === 126) {
      if (buf.length < offset + 4) break;
      len = buf.readUInt16BE(offset + 2);
      header = 4;
    } else if (len === 127) {
      if (buf.length < offset + 10) break;
      const big = buf.readBigUInt64BE(offset + 2);
      if (big > 1_000_000n) {
        socket.end();
        return Buffer.alloc(0);
      }
      len = Number(big);
      header = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + header + maskLen + len) break;
    let payload = buf.subarray(
      offset + header + maskLen,
      offset + header + maskLen + len,
    );
    if (masked) {
      const mask = buf.subarray(offset + header, offset + header + 4);
      const copy = Buffer.from(payload);
      for (let i = 0; i < copy.length; i++) {
        copy[i] = (copy[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
      payload = copy;
    }
    offset += header + maskLen + len;
    if (opcode === 0x8) {
      writeFrame(socket, 0x8, Buffer.alloc(0));
      socket.end();
      return Buffer.alloc(0);
    }
    if (opcode === 0x9) {
      writeFrame(socket, 0x0a, payload);
      continue;
    }
    if (opcode === 0x1 || opcode === 0x0) onText(payload.toString("utf8"));
  }
  return buf.subarray(offset);
}

export function acceptImGatewayLocalWs(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: { readonly xrkHome?: string; readonly env?: NodeJS.ProcessEnv } = {},
): void {
  const env = options.env ?? ingress.env;
  if (!pushAuthorized(req, env)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key.trim()) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(key.trim() + WS_GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  let pending: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  const onData = (chunk: Buffer | string) => {
    pending = Buffer.concat([
      pending,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ]);
    pending = consumeImGatewayWsFrames(pending, socket, (text) => {
      ingestText(text, options.xrkHome ?? ingress.xrkHome);
    });
  };
  socket.on("data", onData);
}

/** Register the local upgrade. Safe to call again; the handler reads latest home. */
export function configureImGatewayLocalWs(options: {
  readonly xrkHome?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): void {
  if (options.xrkHome !== undefined) ingress.xrkHome = options.xrkHome;
  if (options.env) ingress.env = options.env;
  registerDshCompatUpgrade({
    path: IM_GATEWAY_LOCAL_WS_PATH,
    handler: (req, socket, head) => {
      acceptImGatewayLocalWs(req, socket, head, {
        ...(ingress.xrkHome ? { xrkHome: ingress.xrkHome } : {}),
        env: ingress.env,
      });
    },
  });
}
