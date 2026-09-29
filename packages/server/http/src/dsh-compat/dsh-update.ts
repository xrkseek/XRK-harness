/**
 * `/api/update/*` for `@linxin666/dsh-web-all` / dsh-update client.
 *
 * The browser half treats any 200 JSON as {@link UpdateStatus} and reads
 * `packages` without optional chaining on the array — the honest HTTP
 * catch-all body (`{ ok, status, path, … }`) throws during ResultBody and
 * takes down `sidebar.footer.action`. Return a client-shaped snapshot instead.
 *
 * XRK does not run DSH profile `pnpm update`; status reports the staged
 * aggregate when present, otherwise `mode: "missing"`. Run is refused with
 * `errorCode: "link"` (translated by the panel).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

const AGGREGATE = "@linxin666/dsh-web-all";

export type DshUpdateHttpOptions = {
  readonly pluginsDir?: string;
};

type UpdatePackageStatus = {
  readonly name: string;
  readonly current: string;
  readonly latest?: string;
};

type UpdateStatus = {
  readonly mode: "npm" | "link" | "missing";
  readonly profileName?: string;
  readonly anchor?: string;
  readonly packages: readonly UpdatePackageStatus[];
  readonly outdated: boolean;
  readonly error?: string;
  readonly adapter: string;
  readonly note?: string;
};

type UpdateRunResult = {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly output: string;
  readonly error?: string;
  readonly errorCode?: string;
  readonly adapter: string;
};

function readStagedAggregateVersion(pluginsDir: string | undefined): string | undefined {
  if (!pluginsDir) return undefined;
  const manifest = path.join(
    path.resolve(pluginsDir),
    "web",
    "plugins",
    ...AGGREGATE.split("/"),
    "package.json",
  );
  if (!existsSync(manifest)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    return typeof raw.version === "string" && raw.version.trim()
      ? raw.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function statusOf(pluginsDir: string | undefined): UpdateStatus {
  const version = readStagedAggregateVersion(pluginsDir);
  if (version === undefined) {
    return {
      mode: "missing",
      packages: [],
      outdated: false,
      adapter: DSH_COMPAT_ADAPTER,
      note: "No staged @linxin666/dsh-web-all; DSH profile pnpm update is not hosted on XRK.",
    };
  }
  return {
    mode: "npm",
    anchor: AGGREGATE,
    packages: [{ name: AGGREGATE, current: version, latest: version }],
    outdated: false,
    adapter: DSH_COMPAT_ADAPTER,
    note: "XRK reports the staged aggregate; DSH profile pnpm update is not hosted here.",
  };
}

function runRefused(): UpdateRunResult {
  return {
    ok: false,
    exitCode: null,
    output: "",
    errorCode: "link",
    error:
      "XRK does not run DSH profile `pnpm update`. Update community clients from Settings → Plugins.",
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export function isDshUpdatePath(pathname: string): boolean {
  return pathname === "/api/update" || pathname.startsWith("/api/update/");
}

export async function handleDshUpdateHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshUpdateHttpOptions = {},
): Promise<boolean> {
  if (!isDshUpdatePath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const sub = pathname === "/api/update" ? "" : pathname.slice("/api/update/".length);

  if ((sub === "" || sub === "status") && (method === "GET" || method === "HEAD")) {
    if (method === "HEAD") {
      res.writeHead(200, { "cache-control": "no-store", "content-length": "0" });
      res.end();
      return true;
    }
    sendJson(res, 200, statusOf(options.pluginsDir));
    return true;
  }

  if (sub === "run" && method === "POST") {
    sendJson(res, 200, runRefused());
    return true;
  }

  sendJson(res, 404, {
    ok: false,
    error: "not-found",
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
