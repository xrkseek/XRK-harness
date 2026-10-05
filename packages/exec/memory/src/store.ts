/**
 * Curated memory files (MEMORY.md / USER.md). Snapshot is frozen at construction
 * (session start). Later writes update disk only.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/xrk-home-paths";

export const ENTRY_DELIMITER = "\n§\n";
export const MEMORY_CHAR_LIMIT = 2200;
export const USER_CHAR_LIMIT = 1375;
/** Sidecar beside MEMORY.md/USER.md: entry hash -> epoch ms of its last tracked write. */
export const USAGE_SIDECAR_FILE = ".usage.json";

const HEADERS = {
  memory:
    "MEMORY (durable facts across sessions — not a todo list or unfinished-work queue)",
  user: "USER PROFILE (who the user is)",
} as const;

export type CuratedMemoryTarget = "memory" | "user";
export type CuratedMemoryAction = "add" | "replace" | "remove";

export interface CuratedMemoryOperation {
  readonly action?: string;
  readonly content?: string;
  readonly new_text?: string;
  readonly old_text?: string;
}

export interface CuratedMemoryWriteResult {
  readonly success: boolean;
  readonly done?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly target?: string;
  readonly usage?: string;
  readonly entry_count?: number;
  readonly current_entries?: readonly string[];
  readonly note?: string;
  readonly drift_backup?: string;
  /** Longest-untouched entries; safe candidates when the char cap blocks a write. */
  readonly prune_candidates?: readonly string[];
}

/** One entry plus its age evidence. `tracked: false` = file-mtime fallback only. */
export interface MemoryEntryAge {
  readonly entry: string;
  /** Epoch ms of the last tracked write; falls back to file mtime when unknown. */
  readonly lastTouchedAt: number;
  readonly ageDays: number | null;
  readonly tracked: boolean;
}

/** File providers return sync; HTTP providers may return Promises. */
export type MaybeAsync<T> = T | Promise<T>;

export interface CuratedMemoryStore {
  readonly dir: string;
  /** Frozen load-time block. Empty string when that file had no entries. */
  frozenPrompt(target: CuratedMemoryTarget): string;
  /** Both frozen blocks, joined. Does not re-read disk. */
  frozenSystemBlock(): string;
  /** Live entries (re-read; for Phase1 consolidate / tooling). */
  listEntries(target: CuratedMemoryTarget): MaybeAsync<readonly string[]>;
  add(
    target: CuratedMemoryTarget,
    content: string,
  ): MaybeAsync<CuratedMemoryWriteResult>;
  replace(
    target: CuratedMemoryTarget,
    oldText: string,
    content: string,
  ): MaybeAsync<CuratedMemoryWriteResult>;
  remove(
    target: CuratedMemoryTarget,
    oldText: string,
  ): MaybeAsync<CuratedMemoryWriteResult>;
  applyBatch(
    target: CuratedMemoryTarget,
    operations: readonly CuratedMemoryOperation[],
  ): MaybeAsync<CuratedMemoryWriteResult>;
  /**
   * Entries by staleness (longest untouched first), so a full memory file trims
   * facts nobody maintains instead of whatever happens to sit first in the file.
   * Optional: pluggable providers (http/sqlite) need not carry the sidecar.
   */
  staleEntries?(
    target: CuratedMemoryTarget,
    limit?: number,
  ): MaybeAsync<readonly MemoryEntryAge[]>;
}

export interface CreateCuratedMemoryStoreOptions {
  /** Override the memories directory (tests). Default `{XRK_HOME}/memories`. */
  readonly dir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

function fileFor(dir: string, target: CuratedMemoryTarget): string {
  return path.join(dir, target === "user" ? "USER.md" : "MEMORY.md");
}

function limitFor(target: CuratedMemoryTarget): number {
  return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

function parseEntries(raw: string): string[] {
  return raw
    .split(ENTRY_DELIMITER)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function dedupe(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function charCount(entries: readonly string[]): number {
  return entries.join(ENTRY_DELIMITER).length;
}

function usagePct(current: number, limit: number): string {
  const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
  return `${pct}% — ${current.toLocaleString("en-US")}/${limit.toLocaleString("en-US")} chars`;
}

function readRaw(file: string): { raw: string; ok: boolean } {
  try {
    const text = readFileSync(file, "utf8");
    const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return { raw, ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { raw: "", ok: true };
    return { raw: "", ok: false };
  }
}

function drifted(raw: string, target: CuratedMemoryTarget): boolean {
  if (!raw.trim()) return false;
  const parsed = parseEntries(raw);
  const roundTrip = raw.trim() === parsed.join(ENTRY_DELIMITER);
  const maxLen = parsed.reduce((max, entry) => Math.max(max, entry.length), 0);
  return !(roundTrip && maxLen <= limitFor(target));
}

function renderBlock(target: CuratedMemoryTarget, entries: readonly string[]): string {
  if (entries.length === 0) return "";
  const content = entries.join(ENTRY_DELIMITER);
  const sep = "═".repeat(46);
  return `${sep}\n${HEADERS[target]} [${usagePct(content.length, limitFor(target))}]\n${sep}\n${content}`;
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    renameSync(tmp, file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EPERM") {
      try {
        unlinkSync(file);
      } catch {
        /* destination may already be gone */
      }
      renameSync(tmp, file);
      return;
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

interface UsageSidecarShape {
  readonly entries?: Record<string, number>;
}

/** Content hash keeps the sidecar small and survives renames of the file. */
function entryKey(entry: string): string {
  return createHash("sha256").update(entry).digest("hex").slice(0, 16);
}

function readUsage(file: string): Record<string, number> {
  const { raw, ok } = readRaw(file);
  if (!ok || !raw.trim()) return {};
  let parsed: UsageSidecarShape;
  try {
    parsed = JSON.parse(raw) as UsageSidecarShape;
  } catch {
    return {};
  }
  const entries = parsed.entries;
  if (!entries || typeof entries !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = value;
    }
  }
  return out;
}

function writeUsage(file: string, entries: Record<string, number>): void {
  try {
    writeAtomic(file, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  } catch {
    /* usage tracking is advisory: never fail a memory write over it */
  }
}

function fileMtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Oldest-touched first. Stable sort, so a memory file with no usage history
 * degrades to the old "trim whatever is first" behavior instead of guessing.
 */
function rankByStaleness(
  entries: readonly string[],
  usage: Record<string, number>,
  fallbackAt: number,
  now: number,
): MemoryEntryAge[] {
  const ranked = entries.map((entry) => {
    const hit = usage[entryKey(entry)];
    const known = typeof hit === "number" && hit > 0;
    const lastTouchedAt = known ? hit : fallbackAt;
    return {
      entry,
      lastTouchedAt,
      ageDays: lastTouchedAt > 0 ? Math.floor((now - lastTouchedAt) / 86_400_000) : null,
      tracked: known,
    };
  });
  ranked.sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
  return ranked;
}

function withFileLock<T>(lockPath: string, fn: () => T): T {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const start = Date.now();
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, "wx");
      try {
        return fn();
      } finally {
        closeSync(fd);
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (fd !== undefined) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > 3000) {
        throw new Error(`curated memory lock timed out: ${lockPath}`, {
          cause: err,
        });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
}

function fail(
  message: string,
  extra: Omit<CuratedMemoryWriteResult, "success" | "error"> = {},
): CuratedMemoryWriteResult {
  return { success: false, error: message, ...extra };
}

function failWithEntries(
  target: CuratedMemoryTarget,
  entries: readonly string[],
  message: string,
  pruneCandidates?: readonly string[],
): CuratedMemoryWriteResult {
  return fail(message, {
    target,
    current_entries: entries,
    usage: `${charCount(entries).toLocaleString("en-US")}/${limitFor(target).toLocaleString("en-US")}`,
    ...(pruneCandidates && pruneCandidates.length > 0 ? { prune_candidates: pruneCandidates } : {}),
  });
}

function saved(
  target: CuratedMemoryTarget,
  message: string,
  entries: readonly string[],
): CuratedMemoryWriteResult {
  const current = charCount(entries);
  return {
    success: true,
    done: true,
    target,
    usage: usagePct(current, limitFor(target)),
    entry_count: entries.length,
    message,
    note: "Write saved to disk. This session's system-prompt snapshot is unchanged — do not repeat the write.",
  };
}

type Step =
  | { kind: "write"; entries: string[]; message: string; touched?: readonly string[] }
  | { kind: "done"; result: CuratedMemoryWriteResult };

function findMatch(
  entries: readonly string[],
  oldText: string,
): { index: number | null; ambiguous: boolean; matches: string[] } {
  const matches = entries.filter((entry) => entry.includes(oldText));
  if (new Set(matches).size > 1) {
    return { index: null, ambiguous: true, matches };
  }
  const index = entries.findIndex((entry) => entry.includes(oldText));
  return { index: index >= 0 ? index : null, ambiguous: false, matches };
}

function opContent(op: CuratedMemoryOperation): string {
  return String(op.content ?? op.new_text ?? "").trim();
}

export function createCuratedMemoryStore(
  options: CreateCuratedMemoryStoreOptions = {},
): CuratedMemoryStore {
  const explicit = options.dir?.trim();
  const dir = explicit
    ? path.resolve(explicit)
    : path.join(resolveXrkHome(options.env ?? process.env), "memories");
  const usagePath = path.join(dir, USAGE_SIDECAR_FILE);
  const snapshot: Record<CuratedMemoryTarget, string> = {
    memory: "",
    user: "",
  };
  for (const target of ["memory", "user"] as const) {
    const { raw, ok } = readRaw(fileFor(dir, target));
    const entries = ok ? dedupe(parseEntries(raw)) : [];
    snapshot[target] = renderBlock(target, entries);
  }

  function rankedEntries(target: CuratedMemoryTarget): MemoryEntryAge[] {
    const file = fileFor(dir, target);
    const { raw, ok } = readRaw(file);
    if (!ok) return [];
    return rankByStaleness(
      dedupe(parseEntries(raw)),
      readUsage(usagePath),
      fileMtimeMs(file),
      Date.now(),
    );
  }

  function pruneCandidates(target: CuratedMemoryTarget, limit: number): string[] {
    return rankedEntries(target)
      .slice(0, limit)
      .map((item) =>
        item.entry.length > 140 ? `${item.entry.slice(0, 140)}...` : item.entry,
      );
  }

  function mutate(target: CuratedMemoryTarget, apply: (entries: string[], limit: number) => Step) {
    const file = fileFor(dir, target);
    return withFileLock(`${file}.lock`, () => {
      const { raw, ok } = readRaw(file);
      if (!ok) {
        return fail(
          `Refusing to write ${path.basename(file)}: the file exists but could not be read. Nothing was changed.`,
        );
      }
      if (drifted(raw, target)) {
        const bak = `${file}.bak.${Date.now()}`;
        try {
          writeFileSync(bak, raw, "utf8");
        } catch {
          /* refuse even if the backup cannot be written */
        }
        return fail(
          `Refusing to write ${path.basename(file)}: on-disk content would not round-trip through add/replace/remove. A snapshot was saved to ${bak}.`,
          { drift_backup: bak },
        );
      }
      const entries = dedupe(parseEntries(raw));
      const step = apply(entries, limitFor(target));
      if (step.kind === "done") return step.result;
      writeAtomic(file, step.entries.join(ENTRY_DELIMITER));
      if (step.touched && step.touched.length > 0) {
        const usage = readUsage(usagePath);
        const at = Date.now();
        for (const entry of step.touched) usage[entryKey(entry)] = at;
        writeUsage(usagePath, usage);
      }
      return saved(target, step.message, step.entries);
    });
  }

  function edit(
    target: CuratedMemoryTarget,
    oldText: string,
    next: string | null,
  ): CuratedMemoryWriteResult {
    const needle = oldText.trim();
    if (!needle) return fail("old_text cannot be empty.");
    if (next !== null && !next.trim()) {
      return fail("content cannot be empty. Use remove to delete an entry.");
    }
    const replacement = next?.trim() ?? null;
    return mutate(target, (entries, limit) => {
      const found = findMatch(entries, needle);
      if (found.ambiguous) {
        return {
          kind: "done",
          result: fail(`Multiple entries matched '${needle}'. Be more specific.`, {
            current_entries: found.matches.map((entry) =>
              entry.length > 80 ? `${entry.slice(0, 80)}...` : entry,
            ),
          }),
        };
      }
      if (found.index === null) {
        return {
          kind: "done",
          result: failWithEntries(
            target,
            entries,
            `No entry matched '${needle}'.`,
          ),
        };
      }
      const replaced = [
        ...entries.slice(0, found.index),
        ...(replacement === null ? [] : [replacement]),
        ...entries.slice(found.index + 1),
      ];
      if (replacement !== null && charCount(replaced) > limit) {
        return {
          kind: "done",
          result: failWithEntries(
            target,
            entries,
            `Replacement would put memory at ${charCount(replaced).toLocaleString("en-US")}/${limit.toLocaleString("en-US")} chars.`,
            pruneCandidates(target, 3),
          ),
        };
      }
      return {
        kind: "write",
        entries: replaced,
        message: replacement === null ? "Entry removed." : "Entry replaced.",
        ...(replacement === null ? {} : { touched: [replacement] }),
      };
    });
  }

  return {
    dir,
    frozenPrompt(target) {
      return snapshot[target];
    },
    frozenSystemBlock() {
      return [snapshot.memory, snapshot.user].filter((block) => block.trim()).join("\n\n");
    },
    listEntries(target) {
      const { raw, ok } = readRaw(fileFor(dir, target));
      if (!ok) return [];
      return dedupe(parseEntries(raw));
    },
    staleEntries(target, limit = 0) {
      const ranked = rankedEntries(target);
      return limit > 0 ? ranked.slice(0, limit) : ranked;
    },
    add(target, content) {
      const text = content.trim();
      if (!text) return fail("Content cannot be empty.");
      return mutate(target, (entries, limit) => {
        if (entries.includes(text)) {
          return {
            kind: "done",
            result: saved(target, "Entry already exists (no duplicate added).", entries),
          };
        }
        if (charCount([...entries, text]) > limit) {
          return {
            kind: "done",
            result: failWithEntries(
              target,
              entries,
              `Memory at ${charCount(entries).toLocaleString("en-US")}/${limit.toLocaleString("en-US")} chars. Adding this entry would exceed the limit. remove or replace stale entries, then retry.`,
              pruneCandidates(target, 3),
            ),
          };
        }
        return {
          kind: "write",
          entries: [...entries, text],
          message: "Entry added.",
          touched: [text],
        };
      });
    },
    replace(target, oldText, content) {
      return edit(target, oldText, content);
    },
    remove(target, oldText) {
      return edit(target, oldText, null);
    },
    applyBatch(target, operations) {
      if (operations.length === 0) return fail("operations list is empty.");
      return mutate(target, (entries, limit) => {
        const working = [...entries];
        const touched: string[] = [];
        for (let i = 0; i < operations.length; i += 1) {
          const op = operations[i] ?? {};
          const act = String(op.action ?? "");
          const content = opContent(op);
          const oldText = String(op.old_text ?? "").trim();
          const pos = `Operation ${i + 1} (${act || "unknown"})`;
          if (act === "add") {
            if (!content) {
              return {
                kind: "done",
                result: failWithEntries(target, entries, `${pos}: content is required. Nothing was applied.`),
              };
            }
            if (!working.includes(content)) {
              working.push(content);
              touched.push(content);
            }
            continue;
          }
          if (act !== "replace" && act !== "remove") {
            return {
              kind: "done",
              result: failWithEntries(
                target,
                entries,
                `${pos}: unknown action. Use add, replace, or remove. Nothing was applied.`,
              ),
            };
          }
          if (!oldText) {
            return {
              kind: "done",
              result: failWithEntries(target, entries, `${pos}: old_text is required. Nothing was applied.`),
            };
          }
          if (act === "replace" && !content) {
            return {
              kind: "done",
              result: failWithEntries(
                target,
                entries,
                `${pos}: content is required (use remove to delete). Nothing was applied.`,
              ),
            };
          }
          const found = findMatch(working, oldText);
          if (found.ambiguous) {
            return {
              kind: "done",
              result: failWithEntries(
                target,
                entries,
                `${pos}: '${oldText}' matched multiple distinct entries. Nothing was applied.`,
              ),
            };
          }
          if (found.index === null) {
            return {
              kind: "done",
              result: failWithEntries(
                target,
                entries,
                `${pos}: no entry matched '${oldText}'. Nothing was applied.`,
              ),
            };
          }
          working.splice(found.index, 1, ...(act === "replace" ? [content] : []));
          if (act === "replace") touched.push(content);
        }
        if (entries.length > 0 && working.length === 0) {
          return {
            kind: "done",
            result: failWithEntries(
              target,
              entries,
              `Refusing to empty ${target === "user" ? "USER.md" : "MEMORY.md"} in one batch. Nothing was applied. Use a single remove for the last entry.`,
            ),
          };
        }
        const total = charCount(working);
        if (total > limit) {
          return {
            kind: "done",
            result: failWithEntries(
              target,
              entries,
              `After applying all ${operations.length} operations, memory would be at ${total.toLocaleString("en-US")}/${limit.toLocaleString("en-US")} chars. Nothing was applied.`,
              pruneCandidates(target, 3),
            ),
          };
        }
        return {
          kind: "write",
          entries: working,
          message: `Applied ${operations.length} operation(s).`,
          ...(touched.length > 0 ? { touched } : {}),
        };
      });
    },
  };
}

/** `{XRK_HOME}/memories` — not the Mnemon document library. */
export function defaultCuratedMemoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveXrkHome(env), "memories");
}
