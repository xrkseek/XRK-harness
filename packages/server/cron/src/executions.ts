/**
 * Bounded cron execution ledger (Hermes cron/executions subset).
 * JSONL under product home; newest last; ring ≤ maxEntries.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface CronExecutionRecord {
  readonly id: string;
  readonly jobId: string;
  readonly jobName?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: "ok" | "error" | "skipped";
  readonly error?: string;
  readonly outputChars: number;
  readonly sessionId?: string;
}

export interface CronExecutionLedger {
  append(record: CronExecutionRecord): void;
  list(options?: {
    readonly jobId?: string;
    readonly limit?: number;
  }): readonly CronExecutionRecord[];
}

const DEFAULT_MAX = 1000;

function parseLine(line: string): CronExecutionRecord | undefined {
  try {
    const row = JSON.parse(line) as CronExecutionRecord;
    if (!row || typeof row !== "object") return undefined;
    if (typeof row.id !== "string" || typeof row.jobId !== "string") return undefined;
    if (typeof row.startedAt !== "string" || typeof row.finishedAt !== "string") {
      return undefined;
    }
    if (row.status !== "ok" && row.status !== "error" && row.status !== "skipped") {
      return undefined;
    }
    return {
      id: row.id,
      jobId: row.jobId,
      ...(typeof row.jobName === "string" ? { jobName: row.jobName } : {}),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      status: row.status,
      ...(typeof row.error === "string" && row.error ? { error: row.error } : {}),
      outputChars: typeof row.outputChars === "number" ? row.outputChars : 0,
      ...(typeof row.sessionId === "string" ? { sessionId: row.sessionId } : {}),
    };
  } catch {
    return undefined;
  }
}

function readAll(filePath: string): CronExecutionRecord[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const out: CronExecutionRecord[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = parseLine(line);
      if (row) out.push(row);
    }
    return out;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "ENOENT") return [];
    return [];
  }
}

export function defaultCronExecutionsPath(productHome: string): string {
  return path.join(productHome, "cron", "executions.jsonl");
}

/**
 * Append-only JSONL ledger with periodic rewrite when over capacity.
 */
export function createCronExecutionLedger(options: {
  readonly filePath: string;
  readonly maxEntries?: number;
}): CronExecutionLedger {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX);
  const filePath = options.filePath;
  mkdirSync(path.dirname(filePath), { recursive: true });

  const trimIfNeeded = (): void => {
    const all = readAll(filePath);
    if (all.length <= maxEntries) return;
    const kept = all.slice(all.length - maxEntries);
    writeFileSync(
      filePath,
      `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`,
      "utf8",
    );
  };

  return {
    append(record) {
      appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
      // Cheap size check every append when file may be large — rewrite rarely.
      const all = readAll(filePath);
      if (all.length > maxEntries + 50) trimIfNeeded();
    },
    list(opts = {}) {
      let rows = readAll(filePath);
      if (opts.jobId) {
        const id = opts.jobId.trim();
        rows = rows.filter((r) => r.jobId === id);
      }
      const limit =
        typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0
          ? Math.floor(opts.limit)
          : 50;
      return rows.slice(Math.max(0, rows.length - limit));
    },
  };
}
