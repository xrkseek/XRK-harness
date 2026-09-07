/**
 * Git helpers for dsh-better-sidebar (workspace-scoped, best-effort).
 * Wire shapes match the community client (`xy`, `names`, log array, `{ diff }`).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function isGitRepo(cwd: string): boolean {
  return existsSync(path.join(cwd, ".git"));
}

function runGit(
  cwd: string,
  args: string[],
  options: { allowFail?: boolean } = {},
): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    }).trimEnd();
  } catch (err) {
    if (options.allowFail) {
      const e = err as { stdout?: string; stderr?: string };
      const out = typeof e.stdout === "string" ? e.stdout.trimEnd() : "";
      return out.length > 0 ? out : null;
    }
    return null;
  }
}

function runGitOrThrow(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  }).trimEnd();
}

export interface GitStatusEntry {
  /** Porcelain XY pair — client reads `entry.xy[0]` / `entry.xy[1]`. */
  readonly xy: string;
  /** First porcelain char (index); kept for internal rewind helpers. */
  readonly index: string;
  /** Second porcelain char (worktree). */
  readonly worktree: string;
  readonly path: string;
}

export function gitStatus(cwd: string): {
  available: boolean;
  /** better-sidebar client field (same as `available`). */
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  /** Absolute repo / checkout root when available. */
  root?: string;
} {
  if (!isGitRepo(cwd)) {
    return { available: false, isRepo: false, branch: null, entries: [] };
  }
  const branch = runGit(cwd, ["branch", "--show-current"]);
  const porcelain = runGit(cwd, ["status", "--porcelain", "-uall"]);
  if (porcelain === null) {
    return { available: false, isRepo: false, branch, entries: [] };
  }
  const entries: GitStatusEntry[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 3) continue;
    const xy = line.slice(0, 2);
    let filePath = line.slice(3);
    // rename: "R  old -> new"
    const arrow = filePath.indexOf(" -> ");
    if (arrow >= 0) filePath = filePath.slice(arrow + 4);
    filePath = filePath.replace(/^"|"$/g, "").trim();
    if (!filePath) continue;
    entries.push({
      xy,
      index: xy[0] ?? " ",
      worktree: xy[1] ?? " ",
      path: filePath,
    });
  }
  const root =
    runGit(cwd, ["rev-parse", "--show-toplevel"]) ?? path.resolve(cwd);
  return { available: true, isRepo: true, branch, entries, root };
}

/** One linked checkout (`git.worktrees` → bare array). */
export interface GitWorktree {
  readonly path: string;
  readonly branch: string;
  readonly current: boolean;
  readonly changes: number;
}

/** Raw `git worktree list --porcelain` record. */
export interface GitWorktreeRecord {
  readonly path: string;
  readonly branch: string;
  readonly locked: boolean;
  readonly prunable: boolean;
}

/** Platform-aware identity for comparing absolute checkout roots. */
function pathIdentity(p: string): string {
  const absolute = path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/**
 * Parse `git worktree list --porcelain` (NUL or newline framed).
 * Prunable rows stay in the parse result; callers filter them out.
 */
export function parseWorktreeList(output: string): GitWorktreeRecord[] {
  const rows: GitWorktreeRecord[] = [];
  let wtPath: string | undefined;
  let branch = "HEAD";
  let locked = false;
  let prunable = false;
  const flush = (): void => {
    if (wtPath !== undefined) {
      rows.push({ path: wtPath, branch, locked, prunable });
    }
    wtPath = undefined;
    branch = "HEAD";
    locked = false;
    prunable = false;
  };
  const sep = output.includes("\0") ? "\0" : "\n";
  const framed = output.endsWith(sep) ? output : `${output}${sep}`;
  for (const line of framed.split(sep)) {
    if (line === "") {
      flush();
    } else if (line.startsWith("worktree ")) {
      wtPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      branch = line.slice("branch refs/heads/".length);
    } else if (line === "locked" || line.startsWith("locked ")) {
      locked = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      prunable = true;
    }
  }
  return rows;
}

/** Usable linked checkouts (prunable paths omitted). */
function listedWorktrees(cwd: string): GitWorktreeRecord[] {
  if (!isGitRepo(cwd)) return [];
  const currentRoot =
    runGit(cwd, ["rev-parse", "--show-toplevel"]) ?? path.resolve(cwd);
  const raw = runGit(cwd, ["worktree", "list", "--porcelain", "-z"], {
    allowFail: true,
  });
  if (raw === null) {
    return [
      {
        path: currentRoot,
        branch: runGit(cwd, ["branch", "--show-current"]) || "HEAD",
        locked: false,
        prunable: false,
      },
    ];
  }
  const listed = parseWorktreeList(raw).filter((entry) => !entry.prunable);
  if (listed.length > 0) return listed;
  return [
    {
      path: currentRoot,
      branch: runGit(cwd, ["branch", "--show-current"]) || "HEAD",
      locked: false,
      prunable: false,
    },
  ];
}

/**
 * Linked checkouts for the repo containing `cwd`.
 * Current checkout is first; prunable (missing) paths are omitted.
 */
export function gitWorktrees(cwd: string): GitWorktree[] {
  if (!isGitRepo(cwd)) return [];
  const currentRoot =
    runGit(cwd, ["rev-parse", "--show-toplevel"]) ?? path.resolve(cwd);
  const listed = listedWorktrees(cwd);
  const currentId = pathIdentity(currentRoot);
  const rows: GitWorktree[] = listed.map((entry) => ({
    path: entry.path,
    branch: entry.branch,
    current: pathIdentity(entry.path) === currentId,
    changes: gitStatus(entry.path).entries.length,
  }));
  return rows.sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * Resolve a client-selected linked checkout. Rejects paths outside the
 * session repository's worktree list (membership only — no status scan).
 */
export function resolveGitWorktree(
  cwd: string,
  requested: string | undefined,
): string {
  if (requested === undefined || requested.trim() === "") return cwd;
  const identity = pathIdentity(requested);
  const match = listedWorktrees(cwd).find(
    (entry) => pathIdentity(entry.path) === identity,
  );
  if (!match) {
    throw new Error(`unknown linked worktree: ${requested}`);
  }
  return match.path;
}

/** Client expects `{ current, names }` (not `branches`). */
export function gitBranches(cwd: string): {
  available: boolean;
  current: string;
  names: string[];
} {
  if (!isGitRepo(cwd)) {
    return { available: false, current: "", names: [] };
  }
  const current = runGit(cwd, ["branch", "--show-current"]) ?? "";
  const listed = runGit(cwd, ["branch", "--format=%(refname:short)"]);
  const names = listed
    ? listed.split(/\r?\n/).map((b) => b.trim()).filter(Boolean)
    : [];
  return { available: true, current, names };
}

export interface GitLogEntry {
  readonly hash: string;
  readonly hashFull: string;
  readonly subject: string;
  readonly author: string;
  readonly date: string;
  readonly refs: string;
}

/** Client expects a bare array (not `{ entries }`). */
export function gitLog(
  cwd: string,
  limit = 20,
  skip = 0,
): GitLogEntry[] {
  if (!isGitRepo(cwd)) return [];
  const max = Math.min(Math.max(limit, 1), 100);
  const offset = Math.max(0, Math.floor(skip));
  const out = runGit(cwd, [
    "log",
    `-n`,
    String(max),
    `--skip=${String(offset)}`,
    "--pretty=format:%h%x00%H%x00%s%x00%an%x00%ar%x00%D",
  ]);
  if (!out) return [];
  return out.split(/\r?\n/).flatMap((line) => {
    const [hash, hashFull, subject, author, date, refs] = line.split("\0");
    if (!hash || !hashFull) return [];
    return [
      {
        hash,
        hashFull,
        subject: subject ?? "",
        author: author ?? "",
        date: date ?? "",
        refs: refs ?? "",
      },
    ];
  });
}

export function gitDiff(
  cwd: string,
  filePath: string | undefined,
  staged: boolean,
): { diff: string } {
  if (!isGitRepo(cwd)) return { diff: "" };
  const args = ["diff", "--no-color"];
  if (staged) args.push("--cached");
  if (filePath?.trim()) args.push("--", filePath.trim());
  const out = runGit(cwd, args, { allowFail: true });
  return { diff: out ?? "" };
}

export function gitCommitDiff(
  cwd: string,
  hash: string,
): { diff: string } {
  if (!isGitRepo(cwd) || !hash.trim()) return { diff: "" };
  const out = runGit(
    cwd,
    ["show", "--no-color", "--format=", hash.trim()],
    { allowFail: true },
  );
  return { diff: out ?? "" };
}

export function gitStage(cwd: string, filePath?: string): { ok: true } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  if (filePath?.trim()) {
    runGitOrThrow(cwd, ["add", "--", filePath.trim()]);
  } else {
    runGitOrThrow(cwd, ["add", "-A"]);
  }
  return { ok: true };
}

export function gitUnstage(cwd: string, filePath?: string): { ok: true } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  if (filePath?.trim()) {
    runGitOrThrow(cwd, ["restore", "--staged", "--", filePath.trim()]);
  } else {
    runGitOrThrow(cwd, ["restore", "--staged", "."]);
  }
  return { ok: true };
}

export function gitCommit(cwd: string, message: string): { ok: true; hash?: string } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  const msg = message.trim();
  if (!msg) throw new Error("empty commit message");
  runGitOrThrow(cwd, ["commit", "-m", msg]);
  const hash = runGit(cwd, ["rev-parse", "--short", "HEAD"]) ?? undefined;
  return { ok: true, ...(hash ? { hash } : {}) };
}

export function gitCheckout(cwd: string, branch: string): { ok: true } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  const name = branch.trim();
  if (!name) throw new Error("empty branch");
  runGitOrThrow(cwd, ["checkout", name]);
  return { ok: true };
}

export function gitDiscard(cwd: string, filePath: string): { ok: true } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  const p = filePath.trim();
  if (!p) throw new Error("empty path");
  // Untracked: remove; tracked: restore worktree.
  const staged = runGit(cwd, ["ls-files", "--", p]);
  if (!staged) {
    runGitOrThrow(cwd, ["clean", "-f", "--", p]);
  } else {
    runGitOrThrow(cwd, ["restore", "--", p]);
  }
  return { ok: true };
}

export function gitRevert(cwd: string, hash: string): { ok: true } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  runGitOrThrow(cwd, ["revert", "--no-edit", hash.trim()]);
  return { ok: true };
}

export function gitCherryPick(cwd: string, hash: string): { ok: true } {
  if (!isGitRepo(cwd)) throw new Error("not a git repository");
  runGitOrThrow(cwd, ["cherry-pick", hash.trim()]);
  return { ok: true };
}
