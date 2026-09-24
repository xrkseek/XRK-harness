#!/usr/bin/env node
/**
 * Single-platform mock IM sidecar (channel id: `mock`).
 * Implements ADR-0006 sidecar half: GET /health + POST inbound events to Host relay.
 *
 * Usage (Host already listening, e.g. xrkh serve):
 *   node packages/im-gateway-contract/examples/mock-sidecar.mjs
 *   node …/mock-sidecar.mjs --host http://127.0.0.1:9460 --token secret --once "hello"
 *
 * Env:
 *   XRK_IM_HOST_URL          Host base (default http://127.0.0.1:9460)
 *   XRK_IM_GATEWAY_TOKEN     Optional shared secret (also --token)
 *   XRK_IM_MOCK_PORT         Sidecar listen port (default 9471)
 *
 * This is a sample for ONE mock platform — not Telegram/Discord/Slack/….
 */
import { createServer } from "node:http";

const CONTRACT_VERSION = "1";
const CHANNEL = "mock";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const hostBase = (
  arg("--host", process.env.XRK_IM_HOST_URL || "http://127.0.0.1:9460")
).replace(/\/+$/, "");
const token =
  arg("--token", process.env.XRK_IM_GATEWAY_TOKEN || "") || undefined;
const port = Number(
  arg("--port", process.env.XRK_IM_MOCK_PORT || "9471"),
);
const onceText = (() => {
  const i = process.argv.indexOf("--once");
  return i >= 0 ? String(process.argv[i + 1] ?? "mock ping") : undefined;
})();

async function relay(text) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${hostBase}/api/im/gateway/relay`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: CHANNEL,
      botId: "mock-bot",
      text,
      vendor: "mock",
      contractVersion: CONTRACT_VERSION,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `relay ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        status: "ok",
        contractVersion: CONTRACT_VERSION,
        channel: CHANNEL,
      }),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/simulate") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      void (async () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          const text =
            typeof parsed.text === "string" ? parsed.text : "mock event";
          const out = await relay(text);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, relayed: out }));
        } catch (err) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      })();
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
console.error(
  `[im-mock-sidecar] health http://127.0.0.1:${port}/health → Host ${hostBase} channel=${CHANNEL}`,
);

if (onceText !== undefined) {
  try {
    const out = await relay(onceText);
    console.log(JSON.stringify({ ok: true, once: true, relayed: out }));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}
