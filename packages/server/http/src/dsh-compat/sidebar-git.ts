/**
 * Git helpers for dsh-better-sidebar (workspace-scoped, best-effort).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function isGitRepo(cwd: string): boolean {
  return existsSync(path.join(cwd, ".git"));
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return null;
  }
}

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
}

export function gitStatus(cwd: string): {
  available: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
} {
  if (!isGitRepo(cwd)) {
    return { available: false, branch: null, entries: [] };
  }
  const branch = runGit(cwd, ["branch", "--show-current"]);
  const porcelain = runGit(cwd, ["status", "--porcelain"]);
  if (porcelain === null) {
    return { available: false, branch, entries: [] };
  }
  const entries: GitStatusEntry[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    let pathStart = 2;
    while (pathStart < line.length && /[\s]/.test(line[pathStart] ?? "")) {
      pathStart += 1;
    }
    const filePath = line.slice(pathStart).trim();
    if (!filePath) continue;
    entries.push({ path: filePath, index, worktree });
  }
  return { available: true, branch, entries };
}

export function gitBranches(cwd: string): {
  available: boolean;
  current: string | null;
  branches: string[];
} {
  if (!isGitRepo(cwd)) {
    return { available: false, current: null, branches: [] };
  }
  const current = runGit(cwd, ["branch", "--show-current"]);
  const listed = runGit(cwd, ["branch", "--format=%(refname:short)"]);
  const branches = listed
    ? listed.split(/\r?\n/).map((b) => b.trim()).filter(Boolean)
    : [];
  return { available: true, current: current || null, branches };
}

export function gitLog(
  cwd: string,
  limit = 20,
): {
  available: boolean;
  entries: Array<{ hash: string; subject: string; author: string; relative: string }>;
} {
  if (!isGitRepo(cwd)) {
    return { available: false, entries: [] };
  }
  const max = Math.min(Math.max(limit, 1), 100);
  const out = runGit(cwd, [
    "log",
    `-n`,
    String(max),
    "--pretty=format:%H|%s|%an|%ar",
  ]);
  if (!out) return { available: true, entries: [] };
  const entries = out.split(/\r?\n/).map((line) => {
    const [hash = "", subject = "", author = "", relative = ""] = line.split("|");
    return { hash, subject, author, relative };
  });
  return { available: true, entries };
}
