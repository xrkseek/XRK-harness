/**
 * `@linxin666/dsh-client-ui-git-graph` — `/git/*` JSON envelope + SSE keepalive.
 * Reuses sidebar-git for status / branches / checkout / worktrees.
 */
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  gitBranches,
  gitCheckout,
  gitStatus,
  gitWorktrees,
} from "../sidebar/sidebar-git.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { resolveCompatHome } from "./underlying/json-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface GitGraphHttpOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
  readonly defaultCwd?: string;
}

interface GitFeatureConfig {
  autoIsolate: boolean;
  autoBaseline: "current" | "default";
  worktreesHome: string;
}

const CONFIG = createXrkDocStore<{ config: Omit<GitFeatureConfig, "worktreesHome"> }>(
  ["dsh-git-graph", "config.json"],
  { config: { autoIsolate: false, autoBaseline: "current" } },
);

const BAD_REQUEST = { code: "internal", message: "malformed request" } as const;
const INTERNAL = (message: string) => ({ code: "internal", message });

function ok(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value };
}

function fail(error: { code: string; message: string }): {
  ok: false;
  error: { code: string; message: string };
} {
  return { ok: false, error };
}

function sendJson(res: ServerResponse, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function runGit(
  cwd: string,
  args: string[],
  options: { allowFail?: boolean } = {},
): string | null {
  const opts: ExecFileSyncOptions = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  };
  try {
    return execFileSync("git", args, opts).toString().trimEnd();
  } catch (err) {
    if (options.allowFail) {
      const e = err as { stdout?: string };
      const out = typeof e.stdout === "string" ? e.stdout.trimEnd() : "";
      return out.length > 0 ? out : null;
    }
    return null;
  }
}

function isRepo(cwd: string): boolean {
  return existsSync(path.join(cwd, ".git"));
}

function worktreesHome(xrkHome?: string): string {
  return path.join(resolveCompatHome(xrkHome), "worktrees");
}

function featureConfig(xrkHome?: string): GitFeatureConfig {
  const saved = CONFIG.read(xrkHome).data.config;
  return {
    autoIsolate: saved.autoIsolate === true,
    autoBaseline: saved.autoBaseline === "default" ? "default" : "current",
    worktreesHome: worktreesHome(xrkHome),
  };
}

function pathOf(payload: Record<string, unknown>): string | null {
  const p = payload.path;
  return typeof p === "string" && p.trim() ? path.resolve(p.trim()) : null;
}

function dirtyCounts(cwd: string): {
  dirtyFiles: number;
  untrackedFiles: number;
  conflicts: number;
} {
  const status = gitStatus(cwd);
  let dirtyFiles = 0;
  let untrackedFiles = 0;
  let conflicts = 0;
  for (const entry of status.entries) {
    if (entry.xy === "??") {
      untrackedFiles += 1;
      continue;
    }
    if (
      entry.xy.includes("U") ||
      entry.xy === "AA" ||
      entry.xy === "DD"
    ) {
      conflicts += 1;
      continue;
    }
    dirtyFiles += 1;
  }
  return { dirtyFiles, untrackedFiles, conflicts };
}

function repoStatus(cwd: string) {
  const status = gitStatus(cwd);
  const root = status.root ?? path.resolve(cwd);
  const head = runGit(cwd, ["rev-parse", "HEAD"], { allowFail: true }) ?? "";
  const counts = dirtyCounts(cwd);
  return {
    root,
    branch: status.branch ?? "HEAD",
    head,
    ...counts,
    operationInProgress: false,
  };
}

function branchesView(cwd: string) {
  const status = repoStatus(cwd);
  const listed = gitBranches(cwd);
  const branches = listed.names.map((name) => ({
    name,
    current: name === listed.current,
  }));
  return {
    root: status.root,
    branch: status.branch,
    branches,
    dirtyFiles: status.dirtyFiles,
    untrackedFiles: status.untrackedFiles,
    conflicts: status.conflicts,
    operationInProgress: false,
  };
}

function parseDecoration(decoration: string): string[] {
  if (!decoration) return [];
  return decoration
    .split(", ")
    .map((part) => {
      if (part === "HEAD") return "";
      if (part.startsWith("HEAD -> ")) return part.slice("HEAD -> ".length);
      if (part.startsWith("tag: ")) return part.slice("tag: ".length);
      return part;
    })
    .filter(Boolean);
}

function graphView(cwd: string, limit: number) {
  const status = repoStatus(cwd);
  const max = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const out = runGit(
    cwd,
    [
      "log",
      `-n`,
      String(max + 1),
      "--pretty=format:%H%x00%P%x00%s%x00%an%x00%at%x00%d",
    ],
    { allowFail: true },
  );
  const commits: Array<{
    oid: string;
    parents: string[];
    subject: string;
    author: string;
    authorTime: number;
    refs: string[];
  }> = [];
  if (out) {
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [oid, parentsRaw, subject, author, authorTimeRaw, decoration] =
        line.split("\0");
      if (!oid) continue;
      commits.push({
        oid,
        parents:
          parentsRaw === undefined || parentsRaw === ""
            ? []
            : parentsRaw.split(" ").filter(Boolean),
        subject: subject ?? "",
        author: author ?? "",
        authorTime: Number(authorTimeRaw ?? "0") || 0,
        refs: parseDecoration((decoration ?? "").replace(/^\s*\(|\)\s*$/g, "")),
      });
    }
  }
  const hasMore = commits.length > max;
  return {
    root: status.root,
    branch: status.branch,
    commits: commits.slice(0, max),
    hasMore,
  };
}

function worktreeListView(cwd: string) {
  const status = repoStatus(cwd);
  const rows = gitWorktrees(cwd);
  const worktrees = rows.map((row) => {
    const head =
      runGit(row.path, ["rev-parse", "HEAD"], { allowFail: true }) ?? "";
    return {
      path: row.path,
      head,
      branch: row.branch,
      main: row.current,
    };
  });
  return { root: status.root, worktrees };
}

function ensureUnderWorktreesHome(
  worktreePath: string,
  home: string,
): boolean {
  const resolved = path.resolve(worktreePath);
  const base = path.resolve(home);
  return resolved === base || resolved.startsWith(base + path.sep);
}

export function isGitGraphPath(pathname: string): boolean {
  return pathname === "/git" || pathname.startsWith("/git/");
}

export async function handleGitGraphHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: GitGraphHttpOptions = {},
): Promise<boolean> {
  if (!isGitGraphPath(pathname)) return false;
  const method = httpMethod(req);
  const pathNorm = pathname.replace(/\/+$/, "") || "/git";

  if (pathNorm === "/git/events") {
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return true;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    res.write("retry: 2000\n\n");
    res.write(": keepalive\n\n");
    res.write(`data: ${JSON.stringify({ adapter: DSH_COMPAT_ADAPTER })}\n\n`);
    res.end();
    return true;
  }

  if (method !== "POST") {
    res.writeHead(405);
    res.end();
    return true;
  }

  const payload = await parseJsonBody(req);
  if (pathNorm === "/git/config") {
    sendJson(res, ok(featureConfig(options.xrkHome)));
    return true;
  }

  const cwd = pathOf(payload);
  if (!cwd) {
    sendJson(res, fail(BAD_REQUEST));
    return true;
  }
  if (!isRepo(cwd) && !existsSync(cwd)) {
    sendJson(res, fail(INTERNAL(`not a git repository: ${cwd}`)));
    return true;
  }

  try {
    switch (pathNorm) {
      case "/git/status":
        sendJson(res, ok(repoStatus(cwd)));
        return true;
      case "/git/branches":
        sendJson(res, ok(branchesView(cwd)));
        return true;
      case "/git/graph": {
        const rawLimit = payload.limit;
        const limit =
          typeof rawLimit === "number" && rawLimit > 0
            ? Math.min(rawLimit, 1000)
            : 100;
        sendJson(res, ok(graphView(cwd, limit)));
        return true;
      }
      case "/git/switch": {
        const branch =
          typeof payload.branch === "string" ? payload.branch.trim() : "";
        if (!branch) {
          sendJson(res, fail(BAD_REQUEST));
          return true;
        }
        gitCheckout(cwd, branch);
        sendJson(res, ok(repoStatus(cwd)));
        return true;
      }
      case "/git/create-branch": {
        const name =
          typeof payload.name === "string" ? payload.name.trim() : "";
        if (!name) {
          sendJson(res, fail(BAD_REQUEST));
          return true;
        }
        const created = runGit(cwd, ["checkout", "-b", name], {
          allowFail: true,
        });
        if (created === null && runGit(cwd, ["checkout", name], { allowFail: true }) === null) {
          sendJson(res, fail(INTERNAL(`failed to create branch ${name}`)));
          return true;
        }
        sendJson(res, ok(branchesView(cwd)));
        return true;
      }
      case "/git/worktrees":
        sendJson(res, ok(worktreeListView(cwd)));
        return true;
      case "/git/worktree-add": {
        const name =
          typeof payload.name === "string" ? payload.name.trim() : "";
        const baseRef =
          typeof payload.baseRef === "string" && payload.baseRef.trim()
            ? payload.baseRef.trim()
            : "HEAD";
        if (!name) {
          sendJson(res, fail(BAD_REQUEST));
          return true;
        }
        const home = worktreesHome(options.xrkHome);
        mkdirSync(home, { recursive: true });
        const target = path.join(home, name);
        if (!ensureUnderWorktreesHome(target, home)) {
          sendJson(res, fail(INTERNAL("worktree path escapes worktrees home")));
          return true;
        }
        const args = ["worktree", "add", "-b", name, target, baseRef];
        const added = runGit(cwd, args, { allowFail: true });
        if (added === null && !existsSync(target)) {
          sendJson(res, fail(INTERNAL(`failed to add worktree ${name}`)));
          return true;
        }
        sendJson(res, ok(worktreeListView(cwd)));
        return true;
      }
      case "/git/worktree-remove": {
        const worktreePath =
          typeof payload.worktreePath === "string"
            ? payload.worktreePath.trim()
            : "";
        if (!worktreePath) {
          sendJson(res, fail(BAD_REQUEST));
          return true;
        }
        const home = worktreesHome(options.xrkHome);
        if (!ensureUnderWorktreesHome(worktreePath, home)) {
          sendJson(
            res,
            fail(INTERNAL("refusing to remove worktree outside worktrees home")),
          );
          return true;
        }
        runGit(cwd, ["worktree", "remove", "--force", worktreePath], {
          allowFail: true,
        });
        sendJson(res, ok(worktreeListView(cwd)));
        return true;
      }
      default:
        sendJson(
          res,
          fail({
            code: "internal",
            message: `unknown /git route: ${pathNorm}`,
          }),
        );
        return true;
    }
  } catch (err) {
    sendJson(
      res,
      fail(INTERNAL(err instanceof Error ? err.message : String(err))),
    );
    return true;
  }
}
