/**
 * Turn-rewind workspace capture via git status + file backup.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { dataPath } from "./underlying/json-store.js";
import { gitStatus } from "../sidebar/sidebar-git.js";
import {
  type RewindChange,
  type RewindMarker,
  upsertRewindMarker,
} from "./turn-rewind-store.js";

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

function porcelainKind(index: string, worktree: string): string {
  if (index === "?" || worktree === "?") return "untracked";
  if (index === "A" || worktree === "A") return "added";
  if (index === "D" || worktree === "D") return "deleted";
  return "modified";
}

function backupRoot(xrkHome: string | undefined, checkpointId: string): string {
  const dir = path.join(
    dataPath(xrkHome, "turn-rewind", "files"),
    checkpointId,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function backupFile(
  backupDir: string,
  relPath: string,
  cwd: string,
  kind: string,
): void {
  const dest = path.join(backupDir, relPath);
  mkdirSync(path.dirname(dest), { recursive: true });
  const abs = path.join(cwd, relPath);
  if (kind === "deleted") {
    const content = runGit(cwd, ["show", `HEAD:${relPath}`]);
    if (content !== null) writeFileSync(dest, content, "utf8");
    return;
  }
  if (existsSync(abs)) copyFileSync(abs, dest);
}

export function recordRewindFromGit(options: {
  readonly xrkHome?: string;
  readonly sessionId: string;
  readonly messageSeq: number;
  readonly cwd: string;
  readonly turn?: number;
  readonly turnStartSeq?: number;
  readonly checkpointId?: string;
}): RewindMarker | null {
  const git = gitStatus(options.cwd);
  if (!git.available) return null;

  const checkpointId =
    options.checkpointId?.trim() || `ck-${Date.now()}-${options.messageSeq}`;
  const backupDir = backupRoot(options.xrkHome, checkpointId);
  const changes: RewindChange[] = [];

  for (const entry of git.entries) {
    const kind = porcelainKind(entry.index, entry.worktree);
    if (kind === "untracked") continue;
    changes.push({ path: entry.path, kind });
    backupFile(backupDir, entry.path, options.cwd, kind);
  }

  const branch = git.branch ?? "main";
  const head = runGit(options.cwd, ["rev-parse", "HEAD"]) ?? "";
  const turn = options.turn ?? Math.max(1, Math.floor(options.messageSeq / 2));
  const turnStartSeq =
    options.turnStartSeq ?? Math.max(1, options.messageSeq - 1);
  const confirmation = `${checkpointId}-${Date.now()}`;

  const marker: RewindMarker = {
    sessionId: options.sessionId,
    messageSeq: options.messageSeq,
    turn,
    turnStartSeq,
    checkpointId,
    checkpointBranch: branch,
    currentBranch: branch,
    checkpointHead: head,
    currentHead: head,
    changes,
    planId: checkpointId,
    confirmation,
  };
  upsertRewindMarker(options.xrkHome, marker);
  return marker;
}

export function restoreRewindWorkspace(
  marker: RewindMarker,
  cwd: string,
  xrkHome?: string,
): boolean {
  const backupDir = path.join(
    dataPath(xrkHome, "turn-rewind", "files"),
    marker.checkpointId,
  );
  if (!existsSync(backupDir)) return false;

  let restored = 0;
  const walk = (rel: string): void => {
    const abs = path.join(backupDir, rel);
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) {
        walk(rel ? path.join(rel, name) : name);
      }
      return;
    }
    const dest = path.join(cwd, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
    restored += 1;
  };
  walk("");

  for (const change of marker.changes) {
    if (change.kind !== "added") continue;
    const dest = path.join(cwd, change.path);
    if (existsSync(dest)) {
      try {
        rmSync(dest, { force: true });
        restored += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return restored > 0 || marker.changes.length === 0;
}
