/**
 * In-memory ExecEnvironment — CI / unit tests without disk or HTTP sidecar.
 * Same {@link ExecEnvironmentProvider} seam as local / http (Hermes-style).
 */

import type {
  FsEditOptions,
  FsGlobOptions,
  FsGrepHit,
  FsGrepOptions,
  FsIntentHandler,
  FsService,
  FsStatResult,
} from "@xrkseek/exec-fs";
import {
  EditMismatchError,
  EditWithoutOldError,
  matchGlob,
} from "@xrkseek/exec-fs";
import type {
  SpawnOptions,
  SubprocessHandle,
  SubprocessResult,
  SubprocessService,
} from "@xrkseek/exec-subprocess";
import type { ExecEnvironmentProvider, ExecWorld } from "./types.js";

export type MemorySpawnHandler = (
  argv: readonly string[],
  opts: SpawnOptions | undefined,
  fs: FsService,
) =>
  | SubprocessResult
  | undefined
  | Promise<SubprocessResult | undefined>;

export interface MemoryExecEnvironmentOptions {
  /**
   * Seed files (path → UTF-8 text). Paths may be absolute under the workspace
   * root or relative to it.
   */
  readonly files?: Readonly<Record<string, string>> | ReadonlyMap<string, string>;
  /** Logical workspace root advertised to tools. Default `/workspace`. */
  readonly workspaceRoot?: string;
  /** Optional spawn override; return `undefined` to fall through to builtins. */
  readonly spawnHandler?: MemorySpawnHandler;
}

function normRoot(root: string): string {
  const cleaned = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return cleaned || "/workspace";
}

function joinUnder(root: string, userPath: string): string {
  const r = normRoot(root);
  const u = userPath.replace(/\\/g, "/");
  if (u === r || u.startsWith(`${r}/`)) return u;
  if (u.startsWith("/")) {
    // Absolute path outside the advertised root — map into root (path jail).
    return `${r}/${u.replace(/^\/+/, "")}`;
  }
  return `${r}/${u.replace(/^\/+/, "")}`;
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function createMemoryFs(
  root: string,
  seed: Map<string, string>,
): FsService {
  const files = new Map<string, string>(seed);
  const dirs = new Set<string>([normRoot(root)]);
  for (const p of files.keys()) {
    let cur = parentDir(p);
    while (cur && cur !== "/" && !dirs.has(cur)) {
      dirs.add(cur);
      cur = parentDir(cur);
    }
  }
  const intentHandlers = new Set<FsIntentHandler>();
  const emit = (
    kind: "fs/read-intent" | "fs/write-intent",
    userPath: string,
  ) => {
    for (const h of intentHandlers) h(kind, userPath);
  };

  const ensureParents = (abs: string) => {
    let cur = parentDir(abs);
    while (cur && cur !== "/") {
      if (files.has(cur)) {
        throw new Error(`not a directory: ${cur}`);
      }
      dirs.add(cur);
      cur = parentDir(cur);
    }
  };

  return {
    root: normRoot(root),
    resolvePath(userPath) {
      return joinUnder(root, userPath);
    },
    async read(userPath, maxBytes = 512_000) {
      emit("fs/read-intent", userPath);
      const abs = joinUnder(root, userPath);
      const text = files.get(abs);
      if (text === undefined) {
        throw new Error(`ENOENT: ${abs}`);
      }
      if (text.length > maxBytes) {
        return { content: text.slice(0, maxBytes), truncated: true };
      }
      return { content: text };
    },
    async readBytes(userPath, maxBytes = 512_000) {
      emit("fs/read-intent", userPath);
      const abs = joinUnder(root, userPath);
      const text = files.get(abs);
      if (text === undefined) throw new Error(`ENOENT: ${abs}`);
      const buf = Buffer.from(text, "utf8");
      return Uint8Array.from(
        buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf,
      );
    },
    async write(userPath, content) {
      emit("fs/write-intent", userPath);
      const abs = joinUnder(root, userPath);
      if (dirs.has(abs)) throw new Error(`EISDIR: ${abs}`);
      ensureParents(abs);
      files.set(abs, content);
    },
    async edit(userPath, oldContent, newContent, options?: FsEditOptions) {
      emit("fs/write-intent", userPath);
      const abs = joinUnder(root, userPath);
      const text = files.get(abs);
      if (text === undefined) throw new Error(`ENOENT: ${abs}`);
      if (!oldContent) {
        throw new EditWithoutOldError("edit requires non-empty oldContent");
      }
      const count = text.split(oldContent).length - 1;
      if (count === 0) {
        throw new EditMismatchError("oldContent not found");
      }
      if (!options?.replaceAll && count !== 1) {
        throw new EditMismatchError(
          `oldContent matched ${count} times; pass replaceAll or unique snippet`,
        );
      }
      files.set(
        abs,
        options?.replaceAll
          ? text.split(oldContent).join(newContent)
          : text.replace(oldContent, newContent),
      );
    },
    async remove(userPath) {
      emit("fs/write-intent", userPath);
      const abs = joinUnder(root, userPath);
      if (!files.has(abs)) throw new Error(`ENOENT: ${abs}`);
      files.delete(abs);
    },
    async stat(userPath): Promise<FsStatResult> {
      const abs = joinUnder(root, userPath);
      if (files.has(abs)) {
        return {
          isFile: true,
          isDirectory: false,
          size: files.get(abs)!.length,
        };
      }
      if (dirs.has(abs) || [...files.keys()].some((p) => p.startsWith(`${abs}/`))) {
        return { isFile: false, isDirectory: true, size: 0 };
      }
      throw new Error(`ENOENT: ${abs}`);
    },
    async mkdir(userPath) {
      emit("fs/write-intent", userPath);
      const abs = joinUnder(root, userPath);
      if (files.has(abs)) throw new Error(`EEXIST file: ${abs}`);
      ensureParents(abs);
      dirs.add(abs);
    },
    async glob(pattern, options?: FsGlobOptions) {
      const base = normRoot(root);
      const prefix = `${base}/`;
      const max = options?.maxResults ?? 10_000;
      const out: string[] = [];
      for (const abs of files.keys()) {
        if (!abs.startsWith(prefix) && abs !== base) continue;
        const rel = abs === base ? "" : abs.slice(prefix.length);
        if (matchGlob(rel, pattern) || matchGlob(abs, pattern)) {
          out.push(abs);
          if (out.length >= max) break;
        }
      }
      return out.sort();
    },
    async grep(pattern, options?: FsGrepOptions) {
      const re = new RegExp(
        pattern,
        options?.caseInsensitive ? "i" : undefined,
      );
      const hits: FsGrepHit[] = [];
      const max = options?.maxResults ?? 100;
      const under = options?.path
        ? joinUnder(root, options.path)
        : normRoot(root);
      for (const [abs, text] of files) {
        if (abs !== under && !abs.startsWith(`${under}/`)) continue;
        if (options?.glob) {
          const rel = abs.startsWith(`${normRoot(root)}/`)
            ? abs.slice(normRoot(root).length + 1)
            : abs;
          if (!matchGlob(rel, options.glob) && !matchGlob(abs, options.glob)) {
            continue;
          }
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i]!)) continue;
          hits.push({
            path: abs,
            line: i + 1,
            text: lines[i]!,
          });
          if (hits.length >= max) return hits;
        }
      }
      return hits;
    },
    onIntent(handler) {
      intentHandlers.add(handler);
      return () => {
        intentHandlers.delete(handler);
      };
    },
  };
}

function ok(stdout = "", stderr = ""): SubprocessResult {
  return {
    stdout,
    stderr,
    exitCode: 0,
    signal: null,
    killed: false,
  };
}

function fail(stderr: string, exitCode = 1): SubprocessResult {
  return {
    stdout: "",
    stderr,
    exitCode,
    signal: null,
    killed: false,
  };
}

function createMemorySubprocess(
  fs: FsService,
  spawnHandler?: MemorySpawnHandler,
): SubprocessService {
  async function run(
    argv: readonly string[],
    opts?: SpawnOptions,
  ): Promise<SubprocessResult> {
    opts?.signal?.throwIfAborted();
    if (spawnHandler) {
      const custom = await spawnHandler(argv, opts, fs);
      if (custom !== undefined) return custom;
    }
    if (!argv.length) return fail("empty argv");
    const cmd = argv[0]!;
    if (cmd === "true" || cmd === ":") return ok();
    if (cmd === "false") return fail("", 1);
    if (cmd === "echo") {
      return ok(`${argv.slice(1).join(" ")}\n`);
    }
    if (cmd === "cat") {
      const target = argv[1];
      if (!target) return fail("cat: missing operand");
      try {
        const read = await fs.read(target);
        return ok(read.content);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), 1);
      }
    }
    return fail(`unknown: ${argv.join(" ")}`, 127);
  }

  return {
    spawn: run,
    start(argv, opts) {
      let settled: Promise<SubprocessResult> | undefined;
      const handle: SubprocessHandle = {
        kill() {
          /* memory world — no live process */
        },
        result() {
          settled ??= run(argv, opts);
          return settled;
        },
      };
      return handle;
    },
  };
}

/**
 * Build an in-memory {@link ExecEnvironmentProvider} (tests / CI demos).
 * Always available; no host disk or sidecar.
 */
export function createMemoryExecEnvironment(
  options: MemoryExecEnvironmentOptions = {},
): ExecEnvironmentProvider {
  const defaultRoot = options.workspaceRoot?.trim() || "/workspace";

  return {
    providerName: "memory",
    isAvailable: () => true,
    createWorld({ workspaceRoot }) {
      const root = normRoot(workspaceRoot.trim() || defaultRoot);
      const seed = new Map<string, string>();
      const raw = options.files;
      if (raw) {
        const entries =
          raw instanceof Map ? raw.entries() : Object.entries(raw);
        for (const [p, content] of entries) {
          seed.set(joinUnder(root, p), content);
        }
      }
      const fs = createMemoryFs(root, seed);
      const world: ExecWorld = {
        workspaceRoot: root,
        fs,
        subprocess: createMemorySubprocess(fs, options.spawnHandler),
        dispose() {
          /* memory world is GC'd with the Map */
        },
      };
      return world;
    },
  };
}
