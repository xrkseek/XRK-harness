/**
 * `dsh-server-deck` — `/server-deck/api/*` host catalog + metrics settings.
 * Live SSH/PTY remain honest seat gaps (reuse catalog persistence).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface ServerDeckOptions {
  readonly xrkHome?: string;
}

interface DeckHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: "key" | "password" | "agent";
  keyPath?: string;
  password?: string;
  passphrase?: string;
  tags: string[];
}

interface DeckDoc {
  hosts: DeckHost[];
  metrics: Record<string, unknown>;
}

const STORE = createXrkDocStore<DeckDoc>(["dsh-server-deck", "state.json"], {
  hosts: [],
  metrics: {
    enabled: false,
    refreshSec: 30,
    range: "1h",
    bucket: "auto",
  },
});

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function asPort(v: unknown, fallback = 22): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

function publicHost(h: DeckHost): Record<string, unknown> {
  return {
    id: h.id,
    name: h.name,
    host: h.host,
    port: h.port,
    username: h.username,
    auth: h.auth,
    ...(h.keyPath ? { keyPath: h.keyPath } : {}),
    tags: [...h.tags],
  };
}

function parseSshConfig(text: string): DeckHost[] {
  const hosts: DeckHost[] = [];
  let current: Partial<DeckHost> & { aliases?: string[] } | null = null;
  const flush = (): void => {
    if (!current?.aliases?.length || !current.host) {
      current = null;
      return;
    }
    for (const alias of current.aliases) {
      if (alias.includes("*") || alias.includes("?")) continue;
      hosts.push({
        id: randomUUID(),
        name: alias,
        host: current.host,
        port: current.port ?? 22,
        username: current.username ?? process.env.USERNAME ?? "user",
        auth: current.auth ?? "key",
        ...(current.keyPath ? { keyPath: current.keyPath } : {}),
        tags: [],
      });
    }
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "host") {
      flush();
      current = { aliases: value.split(/\s+/).filter(Boolean) };
    } else if (!current) continue;
    else if (key === "hostname") current.host = value;
    else if (key === "port") current.port = asPort(value);
    else if (key === "user") current.username = value;
    else if (key === "identityfile") {
      current.auth = "key";
      current.keyPath = value.replace(/^~/, homedir());
    }
  }
  flush();
  return hosts;
}

export function isServerDeckPath(pathname: string): boolean {
  return (
    pathname === "/server-deck" || pathname.startsWith("/server-deck/")
  );
}

export async function handleServerDeckHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ServerDeckOptions = {},
): Promise<boolean> {
  if (!isServerDeckPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const api =
    pathname.startsWith("/server-deck/api")
      ? pathname.slice("/server-deck/api".length) || "/"
      : pathname;

  if (api === "/hosts" || api === "/hosts/") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        hosts: STORE.read(xrkHome).data.hosts.map(publicHost),
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const keyPath = asString(body.keyPath);
      const password = asString(body.password);
      const passphrase = asString(body.passphrase);
      const host: DeckHost = {
        id: randomUUID(),
        name: asString(body.name, asString(body.host, "host")),
        host: asString(body.host),
        port: asPort(body.port),
        username: asString(body.username, "user"),
        auth: (asString(body.auth, "key") as DeckHost["auth"]) || "key",
        ...(keyPath ? { keyPath } : {}),
        ...(password ? { password } : {}),
        ...(passphrase ? { passphrase } : {}),
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t): t is string => typeof t === "string")
          : [],
      };
      if (!host.host) {
        sendJson(res, 400, { error: "host-required", adapter: DSH_COMPAT_ADAPTER });
        return true;
      }
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        hosts: [...doc.hosts, host],
      }));
      sendJson(res, 200, { host: publicHost(host), adapter: DSH_COMPAT_ADAPTER });
      return true;
    }
  }

  const hostMatch = /^\/hosts\/([^/]+)(?:\/(test))?$/.exec(api);
  if (hostMatch) {
    const id = decodeURIComponent(hostMatch[1]!);
    const sub = hostMatch[2];
    if (sub === "test" && method === "POST") {
      await parseJsonBody(req).catch(() => ({}));
      const found = STORE.read(xrkHome).data.hosts.some((h) => h.id === id);
      sendJson(res, 200, {
        ok: false,
        error: found ? "ssh-engine-unavailable" : "host-not-found",
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "PATCH") {
      const body = await parseJsonBody(req);
      let updated: DeckHost | undefined;
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        hosts: doc.hosts.map((h) => {
          if (h.id !== id) return h;
          updated = {
            ...h,
            ...(typeof body.name === "string" ? { name: body.name } : {}),
            ...(typeof body.host === "string" ? { host: body.host } : {}),
            ...(body.port !== undefined ? { port: asPort(body.port, h.port) } : {}),
            ...(typeof body.username === "string"
              ? { username: body.username }
              : {}),
            ...(typeof body.auth === "string"
              ? { auth: body.auth as DeckHost["auth"] }
              : {}),
            ...(typeof body.keyPath === "string"
              ? { keyPath: body.keyPath }
              : {}),
            ...(Array.isArray(body.tags)
              ? {
                  tags: body.tags.filter(
                    (t): t is string => typeof t === "string",
                  ),
                }
              : {}),
          };
          return updated;
        }),
      }));
      if (!updated) {
        sendJson(res, 404, { error: "host-not-found", adapter: DSH_COMPAT_ADAPTER });
        return true;
      }
      sendJson(res, 200, { host: publicHost(updated), adapter: DSH_COMPAT_ADAPTER });
      return true;
    }
    if (method === "DELETE") {
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        hosts: doc.hosts.filter((h) => h.id !== id),
      }));
      sendJson(res, 200, { ok: true, adapter: DSH_COMPAT_ADAPTER });
      return true;
    }
  }

  if (api === "/import-ssh-config") {
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const dryRun = body.dryRun === true;
      const configPath = path.join(homedir(), ".ssh", "config");
      if (!existsSync(configPath)) {
        sendJson(res, 200, {
          found: 0,
          importedCount: 0,
          skipped: 0,
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const parsed = parseSshConfig(readFileSync(configPath, "utf8"));
      let importedCount = 0;
      let skipped = 0;
      if (!dryRun) {
        STORE.patch(xrkHome, (doc) => {
          const names = new Set(doc.hosts.map((h) => h.name));
          const next = [...doc.hosts];
          for (const h of parsed) {
            if (names.has(h.name)) {
              skipped += 1;
              continue;
            }
            names.add(h.name);
            next.push(h);
            importedCount += 1;
          }
          return { ...doc, hosts: next };
        });
      } else {
        importedCount = parsed.length;
      }
      sendJson(res, 200, {
        found: parsed.length,
        importedCount,
        skipped,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (api === "/metrics/settings") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        ...STORE.read(xrkHome).data.metrics,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "PATCH" || method === "PUT" || method === "POST") {
      const body = await parseJsonBody(req);
      const doc = STORE.patch(xrkHome, (current) => ({
        ...current,
        metrics: { ...current.metrics, ...body },
      }));
      sendJson(res, 200, { ...doc.data.metrics, adapter: DSH_COMPAT_ADAPTER });
      return true;
    }
  }

  if (api === "/status" || api.startsWith("/status")) {
    sendJson(res, 200, {
      hosts: STORE.read(xrkHome).data.hosts.map((h) => ({
        id: h.id,
        online: false,
        cpuPercent: null,
        memPercent: null,
        diskPercent: null,
      })),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname.startsWith("/server-deck/ws/")) {
    sendJson(res, 426, {
      ok: false,
      error: "upgrade-required",
      message: "server-deck PTY requires WebSocket upgrade.",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
