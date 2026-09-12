/**
 * First fragment of a text/reasoning/tool-call run is durable immediately
 * (Think paints). Later fragments of the same run wait until flush so Face
 * mux seq stays contiguous without a token-rate firehose.
 */
import type { ChunkSink } from "./llm-retry.js";

type LiveChunk = Parameters<ChunkSink>[0];

function runKey(chunk: LiveChunk): string | undefined {
  if (chunk.kind === "usage") return undefined;
  if (chunk.kind === "tool-call") {
    return `tool:${String(chunk.index)}:${chunk.toolCallId ?? ""}:${chunk.toolName ?? ""}`;
  }
  return `${chunk.kind}:${String(chunk.index)}`;
}

function mergeRun(head: LiveChunk, next: LiveChunk): LiveChunk {
  const text = `${head.text}${next.text}`;
  if (head.kind !== "tool-call") {
    return { ...head, text };
  }
  const argumentsDelta = `${head.argumentsDelta ?? head.text}${next.argumentsDelta ?? next.text}`;
  return { ...head, text: argumentsDelta, argumentsDelta };
}

/** Coalesce same-run live deltas after the opening fragment. */
export function createDeltaCoalescer(sink: ChunkSink): {
  push(chunk: LiveChunk): void;
  flush(): void;
} {
  let openKey: string | undefined;
  let tail: LiveChunk | undefined;
  return {
    push(chunk) {
      const key = runKey(chunk);
      if (key === undefined) {
        if (tail !== undefined) {
          sink(tail);
          tail = undefined;
        }
        openKey = undefined;
        sink(chunk);
        return;
      }
      if (openKey === key) {
        tail = tail === undefined ? chunk : mergeRun(tail, chunk);
        return;
      }
      if (tail !== undefined) {
        sink(tail);
        tail = undefined;
      }
      sink(chunk);
      openKey = key;
    },
    flush() {
      if (tail === undefined) return;
      sink(tail);
      tail = undefined;
    },
  };
}
