/**
 * `@michengai/dsh-codex-ui` — preferences persist + dependency catalog shapes.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface DshCodexUiOptions {
  readonly xrkHome?: string;
}

interface WorkspaceGroup {
  readonly id: string;
  readonly name: string;
  readonly workspaceIds: readonly string[];
}

interface PreferencesDoc {
  exists: boolean;
  pinnedWorkspaceIds: string[];
  workspaceGroups: WorkspaceGroup[];
}

const STORE = createXrkDocStore<PreferencesDoc>(
  ["dsh-codex-ui", "preferences.json"],
  {
    exists: false,
    pinnedWorkspaceIds: [],
    workspaceGroups: [],
  },
);

/** Mirrors client `MANAGED_DEPENDENCIES` — status is local inventory, not install. */
const MANAGED_DEPENDENCIES = [
  { id: "ui", packageName: "@michengai/dsh-codex-ui" },
  { id: "experts", packageName: "@michengai/dsh-agency-agents" },
  { id: "skills", packageName: "@michengai/dsh-skills-manager" },
  { id: "archive", packageName: "@michengai/dsh-archive-manager" },
  { id: "im", packageName: "@michengai/dsh-im-connect" },
  { id: "schedule", packageName: "@michengai/dsh-automation" },
  { id: "btw", packageName: "@michengai/dsh-btw" },
  { id: "simplify", packageName: "@michengai/dsh-simplify" },
  { id: "pua", packageName: "@michengai/dsh-pua" },
  { id: "review", packageName: "@michengai/dsh-code-review" },
  { id: "pet", packageName: "@michengai/dsh-codex-pet" },
  { id: "market", packageName: "dshmarket" },
] as const;

function normalizePinned(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(
      ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeGroups(raw: unknown): WorkspaceGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceGroup[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const g = row as Record<string, unknown>;
    const id = typeof g.id === "string" ? g.id.trim() : "";
    const name = typeof g.name === "string" ? g.name.trim() : "";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      workspaceIds: normalizePinned(g.workspaceIds),
    });
  }
  return out;
}

function openInExplorer(target: string): boolean {
  if (!target || !existsSync(target)) return false;
  try {
    if (process.platform === "win32") {
      spawn("explorer.exe", [target], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return true;
    }
    if (process.platform === "darwin") {
      spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

export function isDshCodexUiPath(pathname: string): boolean {
  return (
    pathname === "/api/dsh-codex-ui" || pathname.startsWith("/api/dsh-codex-ui/")
  );
}

export async function handleDshCodexUiHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshCodexUiOptions = {},
): Promise<boolean> {
  if (!isDshCodexUiPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;

  if (pathname === "/api/dsh-codex-ui/connectors") {
    sendJson(res, 200, { connectors: [], adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname === "/api/dsh-codex-ui/dependencies") {
    sendJson(res, 200, {
      dependencies: MANAGED_DEPENDENCIES.map((dep) => ({
        id: dep.id,
        packageName: dep.packageName,
        installed: false,
        updateAvailable: false,
      })),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-codex-ui/preferences") {
    if (method === "GET" || method === "HEAD") {
      const doc = STORE.read(xrkHome).data;
      sendJson(res, 200, {
        exists: doc.exists,
        pinnedWorkspaceIds: [...doc.pinnedWorkspaceIds],
        workspaceGroups: doc.workspaceGroups.map((g) => ({
          id: g.id,
          name: g.name,
          workspaceIds: [...g.workspaceIds],
        })),
        workspaceGroupsSupported: true,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const next: PreferencesDoc = {
        exists: true,
        pinnedWorkspaceIds: normalizePinned(body.pinnedWorkspaceIds),
        workspaceGroups: normalizeGroups(body.workspaceGroups),
      };
      STORE.write(xrkHome, next);
      sendJson(res, 200, {
        ok: true,
        exists: true,
        pinnedWorkspaceIds: next.pinnedWorkspaceIds,
        workspaceGroups: next.workspaceGroups,
        workspaceGroupsSupported: true,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (pathname === "/api/dsh-codex-ui/session-move") {
    await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ok: false,
      error: "session-move/unavailable",
      message:
        "Session move needs a Host session registry; not embedded on XRK-Harness.",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-codex-ui/open-in-explorer") {
    const body = await parseJsonBody(req);
    const target =
      typeof body.path === "string"
        ? body.path
        : typeof body.dir === "string"
          ? body.dir
          : typeof body.cwd === "string"
            ? body.cwd
            : "";
    const resolved = target ? path.resolve(target) : "";
    const ok = openInExplorer(resolved);
    sendJson(res, 200, {
      ok,
      path: resolved || null,
      ...(ok
        ? {}
        : {
            error: "open-failed",
            message: resolved
              ? "Path missing or shell open failed."
              : "path-required",
          }),
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
