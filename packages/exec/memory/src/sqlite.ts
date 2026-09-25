/**
 * SQLite curated MemoryProvider sample (Node ≥22 `node:sqlite`).
 * Same CuratedMemoryStore surface as file/HTTP — proves the pluggable seam.
 * Not Mnemon / memory-embed.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveXrkHome } from "@xrkseek/xrk-home-paths";
import type { MemoryProvider } from "./provider.js";
import {
  ENTRY_DELIMITER,
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
  type CuratedMemoryOperation,
  type CuratedMemoryStore,
  type CuratedMemoryTarget,
  type CuratedMemoryWriteResult,
} from "./store.js";

export interface SqliteMemoryProviderOptions {
  readonly dir?: string;
  /** Absolute db path; default `{dir}/curated-memory.sqlite`. */
  readonly dbPath?: string;
}

function openDb(dbPath: string): DatabaseSync {
  const { DatabaseSync: Db } = process.getBuiltinModule("node:sqlite");
  const db = new Db(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS curated_entries (
      target TEXT NOT NULL,
      seq INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (target, seq)
    );
  `);
  return db;
}

function charLimit(target: CuratedMemoryTarget): number {
  return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

function usageLine(target: CuratedMemoryTarget, chars: number): string {
  return `${chars}/${charLimit(target)}`;
}

function joinEntries(entries: readonly string[]): string {
  return entries.join(ENTRY_DELIMITER);
}

function resultOk(
  target: CuratedMemoryTarget,
  entries: readonly string[],
  message: string,
): CuratedMemoryWriteResult {
  const body = joinEntries(entries);
  return {
    success: true,
    done: true,
    message,
    target,
    usage: usageLine(target, body.length),
    entry_count: entries.length,
    current_entries: entries,
  };
}

function resultFail(
  target: CuratedMemoryTarget,
  entries: readonly string[],
  error: string,
): CuratedMemoryWriteResult {
  const body = joinEntries(entries);
  return {
    success: false,
    error,
    target,
    usage: usageLine(target, body.length),
    entry_count: entries.length,
    current_entries: entries,
  };
}

/**
 * File-backed sqlite curated store under `{XRK_HOME}/memories` by default.
 */
export function createSqliteMemoryProvider(
  options: SqliteMemoryProviderOptions = {},
): SqliteMemoryProvider {
  const dir = options.dir?.trim() || path.join(resolveXrkHome(), "memories");
  mkdirSync(dir, { recursive: true });
  const dbPath =
    options.dbPath?.trim() || path.join(dir, "curated-memory.sqlite");
  const db = openDb(dbPath);

  const list = (target: CuratedMemoryTarget): string[] => {
    const rows = db
      .prepare(
        `SELECT body FROM curated_entries WHERE target = ? ORDER BY seq ASC`,
      )
      .all(target) as Array<{ body: string }>;
    return rows.map((r) => r.body);
  };

  const replaceAll = (target: CuratedMemoryTarget, entries: string[]): void => {
    const tx = db.prepare("BEGIN IMMEDIATE");
    const del = db.prepare(`DELETE FROM curated_entries WHERE target = ?`);
    const ins = db.prepare(
      `INSERT INTO curated_entries (target, seq, body) VALUES (?, ?, ?)`,
    );
    const commit = db.prepare("COMMIT");
    const rollback = db.prepare("ROLLBACK");
    try {
      tx.run();
      del.run(target);
      entries.forEach((body, seq) => {
        ins.run(target, seq, body);
      });
      commit.run();
    } catch (err) {
      try {
        rollback.run();
      } catch {
        /* ignore */
      }
      throw err;
    }
  };

  const frozenMemory = list("memory");
  const frozenUser = list("user");

  const frozenPrompt = (target: CuratedMemoryTarget): string => {
    const entries = target === "user" ? frozenUser : frozenMemory;
    if (entries.length === 0) return "";
    const header =
      target === "user"
        ? "USER PROFILE (who the user is)"
        : "MEMORY (durable facts across sessions — not a todo list or unfinished-work queue)";
    return `${header}\n${joinEntries(entries)}`;
  };

  const applyOps = (
    target: CuratedMemoryTarget,
    operations: readonly CuratedMemoryOperation[],
  ): CuratedMemoryWriteResult => {
    let entries = list(target);
    for (const op of operations) {
      const action = String(op.action ?? "").trim();
      const content = String(op.content ?? op.new_text ?? "").trim();
      const oldText = String(op.old_text ?? "");
      if (action === "add") {
        if (!content) return resultFail(target, entries, "content required");
        entries = [...entries, content];
      } else if (action === "remove") {
        if (!oldText) return resultFail(target, entries, "old_text required");
        const next = entries.filter((e) => !e.includes(oldText));
        if (next.length === entries.length) {
          return resultFail(target, entries, "old_text not found");
        }
        entries = next;
      } else if (action === "replace") {
        if (!oldText || !content) {
          return resultFail(target, entries, "old_text and content required");
        }
        let hits = 0;
        entries = entries.map((e) => {
          if (!e.includes(oldText)) return e;
          hits += 1;
          return content;
        });
        if (hits === 0) return resultFail(target, entries, "old_text not found");
        if (hits > 1) {
          return resultFail(target, entries, "old_text matches multiple entries");
        }
      } else {
        return resultFail(target, entries, `unknown action: ${action}`);
      }
    }
    const body = joinEntries(entries);
    if (body.length > charLimit(target)) {
      return resultFail(
        target,
        list(target),
        `content would exceed the limit (${body.length}/${charLimit(target)})`,
      );
    }
    replaceAll(target, entries);
    return resultOk(target, entries, "Batch applied.");
  };

  const store: CuratedMemoryStore = {
    dir,
    frozenPrompt,
    frozenSystemBlock() {
      return [frozenPrompt("memory"), frozenPrompt("user")]
        .filter(Boolean)
        .join("\n\n");
    },
    listEntries(target) {
      return list(target);
    },
    add(target, content) {
      return applyOps(target, [{ action: "add", content }]);
    },
    replace(target, oldText, content) {
      return applyOps(target, [{ action: "replace", old_text: oldText, content }]);
    },
    remove(target, oldText) {
      return applyOps(target, [{ action: "remove", old_text: oldText }]);
    },
    applyBatch(target, operations) {
      return applyOps(target, operations);
    },
  };

  return {
    ...store,
    providerName: "sqlite",
    isAvailable: () => true,
    close() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}

export type SqliteMemoryProvider = MemoryProvider & { close(): void };
