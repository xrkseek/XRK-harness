/** Local marketing site with real ASSETS from apps/site/public (CSS/JS). */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const publicDir = path.join(root, "apps/site/public");
const workerPath = path.join(root, "apps/site/src/worker.js");
const PORT = Number(process.env.SITE_PORT || 8799);

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function assetResponse(reqPath) {
  const rel = decodeURIComponent(reqPath.split("?")[0]).replace(/^\/+/, "");
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response("missing", { status: 404 });
  }
  const ext = path.extname(file).toLowerCase();
  return new Response(fs.readFileSync(file), {
    status: 200,
    headers: {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

const worker = (await import(pathToFileURL(workerPath).href)).default;
const env = {
  HARNESS_ORIGIN: "http://127.0.0.1:9",
  OPERATORS_SITE: "https://xrk-operators.pages.dev",
  ASSETS: { fetch: (request) => assetResponse(new URL(request.url).pathname) },
};

const srv = http.createServer(async (req, res) => {
  try {
    const url = `https://local.test${req.url || "/"}`;
    const r = await worker.fetch(new Request(url, { headers: req.headers }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

srv.listen(PORT, "127.0.0.1", () => {
  console.log(`ready http://127.0.0.1:${PORT}`);
});
