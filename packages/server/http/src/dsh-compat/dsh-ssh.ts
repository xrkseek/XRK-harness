/**
 * `@linxin666/dsh-ssh` — persisted host catalog under `~/.xrk/dsh-ssh/`.
 * `/test` does a TCP connect probe; exec / tunnel remain honest (no SSH engine).
 */
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface DshSshOptions {
  readonly xrkHome?: string;
}

type AuthKind = "key" | "password" | "agent";

interface HostAuth {
  readonly kind: AuthKind;
  readonly password?: string;
  readonly keyPath?: string;
  readonly passphrase?: string;
  readonly agentPath?: string;
}

/** Stored host — secrets stay on disk, list responses strip them. */
interface StoredHost {
  alias: string;
  host: string;
  port: number;
  user: string;
  auth: HostAuth;
  proxyJump: string[];
  proxyCommand?: string;
  description?: string;
  environment?: string;
  tags: string[];
  location?: string;
}

interface SshDoc {
  hosts: StoredHost[];
}

const STORE = createXrkDocStore<SshDoc>(["dsh-ssh", "hosts.json"], {
  hosts: [],
});

function seatGap(message: string): Record<string, unknown> {
  return {
    ok: false,
    error: "ssh-engine-unavailable",
    message,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

/** TCP reachability only — not an SSH handshake. */
function probeTcp(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        ok,
        latencyMs: Date.now() - started,
        ...(error ? { error } : {}),
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "tcp-timeout"));
    socket.once("error", (err) =>
      finish(false, err instanceof Error ? err.message : String(err)),
    );
  });
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asPort(value: unknown, fallback = 22): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeAuth(raw: unknown, previous?: HostAuth): HostAuth {
  if (raw && typeof raw === "object") {
    const auth = raw as Record<string, unknown>;
    const kind = asString(auth.kind, previous?.kind ?? "key") as AuthKind;
    if (kind === "password") {
      const password =
        asString(auth.password) || previous?.password || "";
      return {
        kind: "password",
        ...(password ? { password } : {}),
      };
    }
    if (kind === "agent") {
      const agentPath =
        asString(auth.agentPath) || previous?.agentPath || "";
      return {
        kind: "agent",
        ...(agentPath ? { agentPath } : {}),
      };
    }
    const keyPath = asString(auth.keyPath) || previous?.keyPath || "";
    const passphrase =
      asString(auth.passphrase) || previous?.passphrase || "";
    return {
      kind: "key",
      ...(keyPath ? { keyPath } : {}),
      ...(passphrase ? { passphrase } : {}),
    };
  }
  return previous ?? { kind: "key" };
}

function publicHost(host: StoredHost): Record<string, unknown> {
  return {
    alias: host.alias,
    host: host.host,
    port: host.port,
    user: host.user,
    auth: host.auth.kind,
    proxyJump: [...host.proxyJump],
    ...(host.proxyCommand ? { proxyCommand: host.proxyCommand } : {}),
    ...(host.description ? { description: host.description } : {}),
    ...(host.environment ? { environment: host.environment } : {}),
    tags: [...host.tags],
    ...(host.location ? { location: host.location } : {}),
  };
}

function mergeHost(
  alias: string,
  body: Record<string, unknown>,
  previous?: StoredHost,
): StoredHost | { error: string } {
  const host = asString(body.host, previous?.host ?? "");
  const user = asString(body.user, previous?.user ?? "");
  if (!alias) return { error: "alias-required" };
  if (!host) return { error: "host-required" };
  if (!user) return { error: "user-required" };
  const proxyCommand = asString(
    body.proxyCommand,
    previous?.proxyCommand ?? "",
  );
  const description = asString(body.description, previous?.description ?? "");
  const environment = asString(
    body.environment,
    previous?.environment ?? "",
  );
  const location = asString(body.location, previous?.location ?? "");
  return {
    alias,
    host,
    port: asPort(body.port, previous?.port ?? 22),
    user,
    auth: normalizeAuth(body.auth, previous?.auth),
    proxyJump:
      body.proxyJump !== undefined
        ? asStringList(body.proxyJump)
        : [...(previous?.proxyJump ?? [])],
    ...(proxyCommand && proxyCommand.toLowerCase() !== "none"
      ? { proxyCommand }
      : {}),
    ...(description ? { description } : {}),
    ...(environment ? { environment } : {}),
    tags:
      body.tags !== undefined
        ? asStringList(body.tags)
        : [...(previous?.tags ?? [])],
    ...(location ? { location } : {}),
  };
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://127.0.0.1");
}

/** Minimal OpenSSH config Host-block parser for import. */
function parseSshConfig(text: string): {
  hosts: StoredHost[];
  skippedBlocks: Array<{ alias: string; reason: string }>;
} {
  const hosts: StoredHost[] = [];
  const skippedBlocks: Array<{ alias: string; reason: string }> = [];
  let current: Partial<StoredHost> & { aliases?: string[] } | null = null;

  const flush = (): void => {
    if (!current?.aliases?.length) {
      current = null;
      return;
    }
    for (const alias of current.aliases) {
      if (alias === "*" || alias.includes("*") || alias.includes("?")) {
        skippedBlocks.push({ alias, reason: "pattern-alias" });
        continue;
      }
      if (!current.host) {
        skippedBlocks.push({ alias, reason: "missing-hostname" });
        continue;
      }
      hosts.push({
        alias,
        host: current.host,
        port: current.port ?? 22,
        user: current.user ?? process.env.USERNAME ?? "user",
        auth: current.auth ?? { kind: "key" },
        proxyJump: current.proxyJump ?? [],
        ...(current.proxyCommand ? { proxyCommand: current.proxyCommand } : {}),
        tags: [],
      });
    }
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "host") {
      flush();
      current = { aliases: value.split(/\s+/).filter(Boolean) };
      continue;
    }
    if (!current) continue;
    if (key === "hostname") current.host = value;
    else if (key === "port") current.port = asPort(value, 22);
    else if (key === "user") current.user = value;
    else if (key === "identityfile") {
      current.auth = { kind: "key", keyPath: value.replace(/^~/, homedir()) };
    } else if (key === "proxyjump") {
      current.proxyJump = value.split(/[, ]+/).filter(Boolean);
    } else if (key === "proxycommand") {
      current.proxyCommand = value;
    }
  }
  flush();
  return { hosts, skippedBlocks };
}

export function isDshSshPath(pathname: string): boolean {
  return pathname === "/api/dsh-ssh" || pathname.startsWith("/api/dsh-ssh/");
}

export async function handleDshSshHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshSshOptions = {},
): Promise<boolean> {
  if (!isDshSshPath(pathname)) return false;
  const method = httpMethod(req);
  const url = requestUrl(req);
  const xrkHome = options.xrkHome;

  if (pathname === "/api/dsh-ssh/hosts") {
    if (method === "GET" || method === "HEAD") {
      const q = (url.searchParams.get("query") ?? "").trim().toLowerCase();
      const hosts = STORE.read(xrkHome).data.hosts
        .filter((h) => {
          if (!q) return true;
          const hay = [
            h.alias,
            h.host,
            h.user,
            h.description ?? "",
            h.environment ?? "",
            h.location ?? "",
            ...h.tags,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
        .map(publicHost);
      sendJson(res, 200, { hosts, adapter: DSH_COMPAT_ADAPTER });
      return true;
    }

    if (method === "POST") {
      const body = await parseJsonBody(req);
      const alias = asString(body.alias);
      const existing = STORE.read(xrkHome).data.hosts;
      if (existing.some((h) => h.alias === alias)) {
        sendJson(res, 409, {
          ok: false,
          error: "alias-exists",
          message: `Host alias already exists: ${alias}`,
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const merged = mergeHost(alias, body);
      if ("error" in merged) {
        sendJson(res, 400, {
          ok: false,
          error: merged.error,
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      STORE.patch(xrkHome, (doc) => ({ hosts: [...doc.hosts, merged] }));
      sendJson(res, 200, {
        ok: true,
        host: publicHost(merged),
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }

    if (method === "PATCH") {
      const body = await parseJsonBody(req);
      const alias = asString(
        url.searchParams.get("alias") ?? body.alias,
      );
      const doc = STORE.read(xrkHome).data;
      const prev = doc.hosts.find((h) => h.alias === alias);
      if (!prev) {
        sendJson(res, 404, {
          ok: false,
          error: "host-not-found",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const merged = mergeHost(alias, body, prev);
      if ("error" in merged) {
        sendJson(res, 400, {
          ok: false,
          error: merged.error,
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      STORE.patch(xrkHome, (current) => ({
        hosts: current.hosts.map((h) => (h.alias === alias ? merged : h)),
      }));
      sendJson(res, 200, {
        ok: true,
        host: publicHost(merged),
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }

    if (method === "DELETE") {
      await parseJsonBody(req).catch(() => ({}));
      const alias = asString(url.searchParams.get("alias"));
      const before = STORE.read(xrkHome).data.hosts.length;
      STORE.patch(xrkHome, (doc) => ({
        hosts: doc.hosts.filter((h) => h.alias !== alias),
      }));
      const after = STORE.read(xrkHome).data.hosts.length;
      sendJson(res, 200, {
        ok: before !== after,
        deleted: before !== after,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (pathname === "/api/dsh-ssh/hosts/import-ssh-config") {
    if (method === "POST" || method === "PUT") {
      await parseJsonBody(req).catch(() => ({}));
    }
    const configPath = path.join(homedir(), ".ssh", "config");
    if (!existsSync(configPath)) {
      sendJson(res, 200, {
        result: {
          parsed: 0,
          added: 0,
          skipped: 0,
          skippedBlocks: [],
        },
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    let text = "";
    try {
      text = readFileSync(configPath, "utf8");
    } catch {
      sendJson(res, 200, {
        result: {
          parsed: 0,
          added: 0,
          skipped: 0,
          skippedBlocks: [{ alias: "*", reason: "unreadable-config" }],
        },
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const parsed = parseSshConfig(text);
    let added = 0;
    const skippedBlocks = [...parsed.skippedBlocks];
    STORE.patch(xrkHome, (doc) => {
      const aliases = new Set(doc.hosts.map((h) => h.alias));
      const next = [...doc.hosts];
      for (const host of parsed.hosts) {
        if (aliases.has(host.alias)) {
          skippedBlocks.push({ alias: host.alias, reason: "already-exists" });
          continue;
        }
        aliases.add(host.alias);
        next.push(host);
        added += 1;
      }
      return { hosts: next };
    });
    sendJson(res, 200, {
      result: {
        parsed: parsed.hosts.length + parsed.skippedBlocks.length,
        added,
        skipped: skippedBlocks.length,
        skippedBlocks,
      },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-ssh/test") {
    const body = await parseJsonBody(req);
    const alias = asString(body.alias);
    const row = STORE.read(xrkHome).data.hosts.find((h) => h.alias === alias);
    if (!row) {
      sendJson(res, 200, {
        result: {
          ok: false,
          alias,
          latencyMs: null,
          error: alias ? `Unknown host alias: ${alias}` : "alias-required",
        },
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const probe = await probeTcp(row.host, row.port);
    sendJson(res, 200, {
      result: {
        ok: probe.ok,
        alias,
        latencyMs: probe.latencyMs,
        ...(probe.error ? { error: probe.error } : {}),
        probe: "tcp",
        note: "TCP connect only; SSH auth/exec is not embedded on XRK-Harness.",
      },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-ssh/exec") {
    const body = await parseJsonBody(req);
    sendJson(res, 200, {
      result: {
        ...seatGap("Remote exec requires an embedded SSH engine (not on XRK-Harness)."),
        alias: asString(body.alias),
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
      },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-ssh/cluster") {
    const body = await parseJsonBody(req);
    const aliases = asStringList(body.aliases ?? body.hosts);
    sendJson(res, 200, {
      results: aliases.map((alias) => ({
        alias,
        ...seatGap("Cluster exec is not embedded on XRK-Harness."),
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
      })),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (
    pathname === "/api/dsh-ssh/upload" ||
    pathname === "/api/dsh-ssh/download" ||
    pathname === "/api/dsh-ssh/ls" ||
    pathname === "/api/dsh-ssh/tunnel" ||
    pathname === "/api/dsh-ssh/terminal"
  ) {
    await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      result: seatGap(
        `${pathname} requires an embedded SSH engine (not on XRK-Harness).`,
      ),
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
