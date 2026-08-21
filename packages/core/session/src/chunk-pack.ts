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

/** Packed tool-call argument deltas (DSH `tool-call-chunks`). */
export interface ToolCallChunkRow {
  readonly type: "tool-call-chunks";
  readonly turnId: string;
  readonly stepId: string;
  readonly index: number;
  readonly toolCallId: string;
  readonly toolName?: string;
  readonly ts0: number;
  readonly dts: readonly number[];
  readonly args: readonly string[];
}

export type PackedStorageRecord =
  | SessionEvent
  | TextChunkRow
  | ToolCallChunkRow;

const MIN_RUN = 3;

type DeltaChunk = Extract<SessionEvent, { type: "assistant/chunk" }>;
type TextDeltaChunk = DeltaChunk & {
  readonly kind?: "text" | "reasoning";
};
type ToolCallDeltaChunk = DeltaChunk & {
  readonly kind: "tool-call";
  readonly toolCallId: string;
};

function isTextDelta(ev: DeltaChunk): ev is TextDeltaChunk {
  return ev.kind !== "usage" && ev.kind !== "tool-call";
}

function isToolCallDelta(ev: DeltaChunk): ev is ToolCallDeltaChunk {
  return ev.kind === "tool-call" && typeof ev.toolCallId === "string";
}

function textKey(ev: TextDeltaChunk): string {
  const kind = ev.kind ?? "text";
  const index = ev.index ?? 0;
  return `${ev.turnId}\0${ev.stepId}\0${kind}\0${index}`;
}

function toolKey(ev: ToolCallDeltaChunk): string {
  const index = ev.index ?? 0;
  const name = ev.toolName ?? "";
  return `${ev.turnId}\0${ev.stepId}\0${index}\0${ev.toolCallId}\0${name}`;
}

function continuesText(prev: TextDeltaChunk, next: TextDeltaChunk): boolean {
  return textKey(prev) === textKey(next);
}

function continuesTool(
  prev: ToolCallDeltaChunk,
  next: ToolCallDeltaChunk,
): boolean {
  return toolKey(prev) === toolKey(next);
}

function buildTextRow(run: readonly TextDeltaChunk[]): TextChunkRow {
  const first = run[0]!;
  const kind = first.kind ?? "text";
  return {
    type: "text-chunks",
    turnId: first.turnId,
    stepId: first.stepId,
    kind: kind === "reasoning" ? "reasoning" : "text",
    index: first.index ?? 0,
    ts0: first.ts,
    dts: run.slice(1).map((ev, i) => ev.ts - run[i]!.ts),
    texts: run.map((ev) => ev.text),
  };
}

function buildToolRow(run: readonly ToolCallDeltaChunk[]): ToolCallChunkRow {
  const first = run[0]!;
  return {
    type: "tool-call-chunks",
    turnId: first.turnId,
    stepId: first.stepId,
    index: first.index ?? 0,
    toolCallId: first.toolCallId,
    ...(first.toolName ? { toolName: first.toolName } : {}),
    ts0: first.ts,
    dts: run.slice(1).map((ev, i) => ev.ts - run[i]!.ts),
    args: run.map((ev) => ev.argumentsDelta ?? ev.text),
  };
}

type PackRun =
  | { kind: "text"; events: TextDeltaChunk[] }
  | { kind: "tool"; events: ToolCallDeltaChunk[] };

/**
 * Collapse runs of consecutive same-block `assistant/chunk` deltas for export /
 * SQLite flush. Live session log stays one event per row.
 */
export function packChunkRunsForExport(
  events: readonly SessionEvent[],
): readonly PackedStorageRecord[] {
  const out: PackedStorageRecord[] = [];
  let run: PackRun | undefined;

  const flush = (): void => {
    if (!run) return;
    if (run.kind === "text") {
      if (run.events.length >= MIN_RUN) out.push(buildTextRow(run.events));
      else out.push(...run.events);
    } else if (run.events.length >= MIN_RUN) {
      out.push(buildToolRow(run.events));
    } else {
      out.push(...run.events);
    }
    run = undefined;
  };

  for (const event of events) {
    if (event.type !== "assistant/chunk") {
      flush();
      out.push(event);
      continue;
    }
    if (isToolCallDelta(event)) {
      if (
        run?.kind === "tool" &&
        continuesTool(run.events[run.events.length - 1]!, event)
      ) {
        run.events.push(event);
        continue;
      }
      flush();
      run = { kind: "tool", events: [event] };
      continue;
    }
    if (!isTextDelta(event)) {
      flush();
      out.push(event);
      continue;
    }
    if (
      run?.kind === "text" &&
      continuesText(run.events[run.events.length - 1]!, event)
    ) {
      run.events.push(event);
      continue;
    }
    flush();
    run = { kind: "text", events: [event] };
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
    if (record.type === "text-chunks") {
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
      continue;
    }
    if (record.type === "tool-call-chunks") {
      let ts = record.ts0;
      for (let i = 0; i < record.args.length; i++) {
        if (i > 0) ts += record.dts[i - 1]!;
        const delta = record.args[i]!;
        out.push({
          type: "assistant/chunk",
          ts,
          turnId: record.turnId,
          stepId: record.stepId,
          text: delta,
          kind: "tool-call",
          index: record.index,
          toolCallId: record.toolCallId,
          ...(record.toolName ? { toolName: record.toolName } : {}),
          argumentsDelta: delta,
        });
      }
      continue;
    }
    out.push(record);
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

export function isToolCallChunkRow(value: unknown): value is ToolCallChunkRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "tool-call-chunks" &&
    typeof v.turnId === "string" &&
    typeof v.stepId === "string" &&
    typeof v.index === "number" &&
    typeof v.toolCallId === "string" &&
    typeof v.ts0 === "number" &&
    Array.isArray(v.dts) &&
    Array.isArray(v.args)
  );
}

export function isPackedChunkRow(
  value: unknown,
): value is TextChunkRow | ToolCallChunkRow {
  return isTextChunkRow(value) || isToolCallChunkRow(value);
}

export interface ParsePackedJSONLResult {
  readonly records: PackedStorageRecord[];
  /** Last non-empty line was not valid JSON or storage record. */
  readonly droppedTrailingIncomplete: boolean;
}

/** Parse export JSONL that may contain packed chunk storage rows. */
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
    if (isPackedChunkRow(raw)) {
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
