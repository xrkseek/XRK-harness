import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SessionEvent } from "@xrkseek/protocol";
import { assertSessionEvent } from "@xrkseek/protocol";
import { writeTextFileAtomicSync } from "./atomic-write.js";
import { deepFreeze, newSessionId } from "./freeze.js";
import { parseJSONL, toJSONL } from "./jsonl.js";
import type { SessionRecord, SessionStore } from "./store.js";

const ID_RE = /^[A-Za-z0-9._-]+$/;

function assertSafeId(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error(`unsafe session id for jsonl store: ${id}`);
  }
  return id;
}

/**
 * Durable SessionStore: one `{id}.jsonl` file per session under `dir`.
 * Load is eager; `append` is sync (one JSON line). Not a SQLite FTS index.
 */
export function createJsonlSessionStore(dir: string): SessionStore {
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });
  const sessions = new Map<string, SessionEvent[]>();

  const fileFor = (id: string): string =>
    path.join(root, `${assertSafeId(id)}.jsonl`);

  for (const name of readdirSync(root)) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    if (!ID_RE.test(id)) continue;
    const file = path.join(root, name);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = parseJSONL(text);
      sessions.set(id, parsed.events);
      if (parsed.droppedTrailingIncomplete) {
        writeTextFileAtomicSync(file, toJSONL(parsed.events));
      }
    } catch {
      /* mid-file corrupt: skip this session so Host can still spawn */
    }
  }

  return {
    create(id = newSessionId()): SessionRecord {
      const sid = assertSafeId(id);
      if (sessions.has(sid)) {
        throw new Error(`session already exists: ${sid}`);
      }
      sessions.set(sid, []);
      writeTextFileAtomicSync(fileFor(sid), "");
      return { id: sid, events: [] };
    },

    get(id: string): SessionRecord {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      return { id, events: [...events] };
    },

    has(id: string): boolean {
      return sessions.has(id);
    },

    append(id: string, event: SessionEvent): SessionEvent {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      const parsed = assertSessionEvent(event);
      const frozen = deepFreeze(structuredClone(parsed));
      events.push(frozen);
      appendFileSync(fileFor(id), `${JSON.stringify(frozen)}\n`, "utf8");
      return frozen;
    },

    list(): readonly string[] {
      return [...sessions.keys()];
    },
  };
}
