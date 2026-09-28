/**
 * @liustack-adjacent desktop pets (dsh-niulai-pet): static KWS engine assets.
 *
 * Host half registers `webServer` prefix `/niulai-kws` on DSH; XRK stages the
 * package `kws/` folder beside `client.js` and serves the same whitelist here.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface NiulaiKwsOptions {
  readonly pluginsDir?: string;
}

/** Allowlisted filenames (same set as dsh-niulai-pet host half). */
const KWS_FILES: Readonly<Record<string, string>> = {
  "sherpa-onnx-wasm-kws-main.js": "text/javascript; charset=utf-8",
  "sherpa-onnx-kws.js": "text/javascript; charset=utf-8",
  "sherpa-onnx-wasm-kws-main.wasm": "application/wasm",
  "sherpa-onnx-wasm-kws-main.data": "application/octet-stream",
  "kws-worker.js": "text/javascript; charset=utf-8",
};

const PLUGIN_IDS = ["dsh-niulai-pet", "niulai-pet"] as const;

export function isNiulaiKwsPath(pathname: string): boolean {
  return pathname === "/niulai-kws" || pathname.startsWith("/niulai-kws/");
}

function resolveKwsFile(
  pluginsDir: string | undefined,
  name: string,
): string | undefined {
  if (!pluginsDir?.trim() || !name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return undefined;
  }
  if (!(name in KWS_FILES)) return undefined;
  const root = path.join(pluginsDir, "web", "plugins");
  for (const id of PLUGIN_IDS) {
    const candidate = path.join(root, id, "kws", name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function handleNiulaiKwsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: NiulaiKwsOptions,
): Promise<boolean> {
  if (!isNiulaiKwsPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return true;
  }
  const name = decodeURIComponent(pathname.slice("/niulai-kws/".length));
  if (!name || name === pathname.slice(1)) {
    res.writeHead(404);
    res.end();
    return true;
  }
  const type = KWS_FILES[name];
  const file = resolveKwsFile(options.pluginsDir, name);
  if (type === undefined || file === undefined) {
    res.writeHead(404);
    res.end();
    return true;
  }
  try {
    const st = statSync(file);
    res.writeHead(200, {
      "content-type": type,
      "content-length": st.size,
      "cache-control": "public, max-age=86400",
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(file);
      stream.on("error", reject);
      stream.on("end", () => resolve());
      stream.pipe(res);
    });
  } catch {
    res.writeHead(404);
    res.end();
  }
  return true;
}
