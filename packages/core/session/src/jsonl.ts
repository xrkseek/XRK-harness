import type { SessionEvent } from "@xrkseek/protocol";
import { assertSessionEvent } from "@xrkseek/protocol";

export function toJSONL(events: readonly SessionEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
}

export interface ParseJSONLResult {
  readonly events: SessionEvent[];
  /** Last non-empty line was not JSON (typical crash mid-append). */
  readonly droppedTrailingIncomplete: boolean;
}

/**
 * Parse JSONL session events.
 * Trailing incomplete last line is dropped (durable reload); mid-file corrupt still throws.
 */
export function parseJSONL(text: string): ParseJSONLResult {
  const rawLines = text.split(/\r?\n/);
  const nonempty: { line: string; display: number }[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!;
    if (!line.trim()) continue;
    nonempty.push({ line, display: nonempty.length + 1 });
  }

  const events: SessionEvent[] = [];
  for (let i = 0; i < nonempty.length; i += 1) {
    const { line, display } = nonempty[i]!;
    const last = i === nonempty.length - 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      if (last) {
        return { events, droppedTrailingIncomplete: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`fromJSONL line ${display}: invalid JSON (${msg})`, {
        cause: err,
      });
    }
    try {
      events.push(assertSessionEvent(raw));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`fromJSONL line ${display}: ${msg}`, { cause: err });
    }
  }
  return { events, droppedTrailingIncomplete: false };
}

export function fromJSONL(text: string): SessionEvent[] {
  return parseJSONL(text).events;
}
