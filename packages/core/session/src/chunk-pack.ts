import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import type { SessionEvent } from "@xrkseek/protocol";
import { assertSessionEvent } from "@xrkseek/protocol";

/** Storage-only row; not a SessionEvent and never appended to the live log. */
export interface TextChunkRow {
  readonly type: "text-chunks";
  readonly turnId: string;
  readonly stepId: string;
  readonly kind: "text" | "reasoning";
  readonly index: number;
  readonly ts0: number;
  readonly dts: readonly number[];
  readonly texts: readonly string[];
}

export type PackedStorageRecord = SessionEvent | TextChunkRow;

const MIN_RUN = 3;

type DeltaChunk = Extract<SessionEvent, { type: "assistant/chunk" }>;

function chunkKey(ev: DeltaChunk): string {
  const kind = ev.kind ?? "text";
  const index = ev.index ?? 0;
  return `${ev.turnId}\0${ev.stepId}\0${kind}\0${index}`;
}

function continues(prev: DeltaChunk, next: DeltaChunk): boolean {
  return chunkKey(prev) === chunkKey(next);
}

function buildRow(run: readonly DeltaChunk[]): TextChunkRow {
  const first = run[0]!;
  return {
    type: "text-chunks",
    turnId: first.turnId,
    stepId: first.stepId,
    kind: first.kind ?? "text",
    index: first.index ?? 0,
    ts0: first.ts,
    dts: run.slice(1).map((ev, i) => ev.ts - run[i]!.ts),
    texts: run.map((ev) => ev.text),
  };
}

/**
 * Collapse runs of consecutive same-block `assistant/chunk` deltas for export.
 * Live session log stays one event per row; this is ZIP/JSONL artifact encoding only.
 */
export function packChunkRunsForExport(
  events: readonly SessionEvent[],
): readonly PackedStorageRecord[] {
  const out: PackedStorageRecord[] = [];
  let run: DeltaChunk[] = [];

  const flush = (): void => {
    if (run.length >= MIN_RUN) {
      out.push(buildRow(run));
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const event of events) {
    if (event.type !== "assistant/chunk") {
      flush();
      out.push(event);
      continue;
    }
    const last = run[run.length - 1];
    if (last !== undefined && continues(last, event)) {
      run.push(event);
      continue;
    }
    flush();
    run = [event];
  }
  flush();
  return out;
}

/** Expand packed export rows back to flat session events (import / round-trip). */
export function expandPackedStorageRecords(
  records: readonly PackedStorageRecord[],
): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (const record of records) {
    if (record.type !== "text-chunks") {
      out.push(record);
      continue;
    }
    let ts = record.ts0;
    for (let i = 0; i < record.texts.length; i++) {
      if (i > 0) ts += record.dts[i - 1]!;
      out.push({
        type: "assistant/chunk",
        ts,
        turnId: record.turnId,
        stepId: record.stepId,
        text: record.texts[i]!,
        kind: record.kind,
        index: record.index,
      });
    }
  }
  return out;
}

export function toPackedJSONL(events: readonly SessionEvent[]): string {
  const packed = packChunkRunsForExport(events);
  return packed.map((row) => JSON.stringify(row)).join("\n") + (packed.length ? "\n" : "");
}

export function isTextChunkRow(value: unknown): value is TextChunkRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "text-chunks" &&
    typeof v.turnId === "string" &&
    typeof v.stepId === "string" &&
    (v.kind === "text" || v.kind === "reasoning") &&
    typeof v.index === "number" &&
    typeof v.ts0 === "number" &&
    Array.isArray(v.dts) &&
    Array.isArray(v.texts)
  );
}

export interface ParsePackedJSONLResult {
  readonly records: PackedStorageRecord[];
  /** Last non-empty line was not valid JSON or storage record. */
  readonly droppedTrailingIncomplete: boolean;
}

/** Parse export JSONL that may contain `text-chunks` storage rows. */
export function parsePackedJSONL(text: string): ParsePackedJSONLResult {
  const rawLines = text.split(/\r?\n/);
  const nonempty: { line: string; display: number }[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!;
    if (!line.trim()) continue;
    nonempty.push({ line, display: nonempty.length + 1 });
  }

  const records: PackedStorageRecord[] = [];
  for (let i = 0; i < nonempty.length; i += 1) {
    const { line, display } = nonempty[i]!;
    const last = i === nonempty.length - 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      if (last) {
        return { records, droppedTrailingIncomplete: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`parsePackedJSONL line ${display}: invalid JSON (${msg})`, {
        cause: err,
      });
    }
    if (isTextChunkRow(raw)) {
      records.push(raw);
      continue;
    }
    try {
      records.push(assertSessionEvent(raw));
    } catch (err) {
      if (last) {
        return { records, droppedTrailingIncomplete: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`parsePackedJSONL line ${display}: ${msg}`, { cause: err });
    }
  }
  return { records, droppedTrailingIncomplete: false };
}

/** Expand packed export JSONL to flat session events. */
export function fromPackedJSONL(text: string): SessionEvent[] {
  return expandPackedStorageRecords(parsePackedJSONL(text).records);
}

export function zstdCompressUtf8(text: string): Buffer {
  return zstdCompressSync(Buffer.from(text, "utf8"));
}

export function zstdDecompressUtf8(buf: Buffer): string {
  return zstdDecompressSync(buf).toString("utf8");
}

/** Decompress a `.jsonl.zst` sidecar and expand to session events. */
export function fromPackedJSONLZstd(buf: Buffer): SessionEvent[] {
  return fromPackedJSONL(zstdDecompressUtf8(buf));
}
