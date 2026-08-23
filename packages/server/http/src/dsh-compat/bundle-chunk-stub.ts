/**
 * Serve Cordis Host lazy chunks under `/…/bundle/<name>.js`.
 * Prefer real `chunks/<name>.js` staged by `xrk-harness plugin add`
 * (from package `lib/client-<name>.js`); fall back to a labeled stub.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface BundleChunkOptions {
  /** Global registry key on window (DSH default `__dshChunks__`). */
  readonly registryGlobal?: string;
  /** URL prefix including trailing path, e.g. `/sidebar/bundle`. */
  readonly urlPrefix: string;
  /** Optional export map: chunk name → export names that become placeholder components. */
  readonly exportsByChunk?: Readonly<Record<string, readonly string[]>>;
  /**
   * Plugins root (`~/.xrk/plugins`). When set, look under
   * `web/plugins/.../chunks/<name>.js` before stubbing.
   */
  readonly pluginsDir?: string;
}

const DEFAULT_SIDEBAR_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  terminal: ["TerminalView"],
  editor: ["TextEditor"],
  mermaid: ["MermaidView"],
  git: ["GitView", "GitPanel"],
  browser: ["BrowserView"],
  search: ["SearchView"],
  jobs: ["JobsView"],
  sidechat: ["SideChatView"],
  diff: ["DiffView"],
  media: ["MediaView"],
};

function stubScript(
  chunk: string,
  registry: string,
  exportNames: readonly string[],
): string {
  const names = exportNames.length > 0 ? exportNames : ["default"];
  const assign = names
    .map(
      (name) =>
        `${JSON.stringify(name)}: function Placeholder(){return require("react").createElement("div",{style:{padding:12,fontSize:12,opacity:.75,lineHeight:1.45}},"[xrk-dsh-compat] chunk ",${JSON.stringify(chunk)}," · Host incomplete — install plugin that ships lib/client-",${JSON.stringify(chunk)},".js");}`,
    )
    .join(",");
  return (
    `;(function(){var g=typeof globalThis!=="undefined"?globalThis:window;` +
    `g[${JSON.stringify(registry)}]=g[${JSON.stringify(registry)}]||{};` +
    `g[${JSON.stringify(registry)}][${JSON.stringify(chunk)}]=function(require){` +
    `return {${assign}};};})();\n`
  );
}

function findInstalledChunk(
  pluginsDir: string,
  chunkName: string,
): string | undefined {
  const root = path.join(pluginsDir, "web", "plugins");
  if (!existsSync(root)) return undefined;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (
        st.isFile() &&
        (name === `${chunkName}.js` || name === `client-${chunkName}.js`) &&
        (dir.endsWith(`${path.sep}chunks`) || name.startsWith("client-"))
      ) {
        return full;
      }
    }
  }
  // Prefer explicit chunks/<name>.js if present under any plugin.
  const preferred = path.join(
    pluginsDir,
    "web",
    "plugins",
    "dsh-better-sidebar",
    "chunks",
    `${chunkName}.js`,
  );
  if (existsSync(preferred)) return preferred;
  return undefined;
}

/**
 * Serve real or stub chunk scripts. Returns true when the request was claimed.
 */
export function handleBundleChunkStub(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: BundleChunkOptions,
): boolean {
  const prefix = options.urlPrefix.endsWith("/")
    ? options.urlPrefix.slice(0, -1)
    : options.urlPrefix;
  if (!pathname.startsWith(`${prefix}/`) || !pathname.endsWith(".js")) {
    return false;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return true;
  }
  const name = decodeURIComponent(
    pathname.slice(prefix.length + 1, -".js".length),
  );
  if (!name || name.includes("/") || name.includes("..")) {
    res.writeHead(404);
    res.end();
    return true;
  }

  let body: string | undefined;
  let etag = `"xrk-stub-${name}-2"`;
  if (options.pluginsDir) {
    const file = findInstalledChunk(options.pluginsDir, name);
    if (file) {
      body = readFileSync(file, "utf8");
      etag = `"xrk-chunk-${name}-${Buffer.byteLength(body)}"`;
    }
  }
  if (body === undefined) {
    const map = options.exportsByChunk ?? DEFAULT_SIDEBAR_EXPORTS;
    const exports = map[name] ?? ["default"];
    body = stubScript(
      name,
      options.registryGlobal ?? "__dshChunks__",
      exports,
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-cache",
    "content-length": String(Buffer.byteLength(body)),
    etag,
  };
  if (method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

export { DEFAULT_SIDEBAR_EXPORTS };
