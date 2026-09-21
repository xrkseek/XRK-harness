/**
 * Face `changes.fileDiff` — on-demand {@link WorkspaceFileDiff} for one
 * listed file on a `workspace/changes` announcement (DSH workspaceChanges.diff).
 *
 * Rebuilds FileDiff captures from the turn's tool/call + tool/result presenters
 * (same path as runTurn emit); no Host-only capture memory required.
 */
import { readSessionEvents } from "@xrkseek/core-session";
import { fileDiffsFromToolPresenters } from "@xrkseek/core-agent-loop";
import type { FileDiff, ToolDefinition } from "@xrkseek/core-tools";
import {
  workspaceFileDiffForListedFile,
  type SessionEvent,
  type WorkspaceFileDiff,
} from "@xrkseek/protocol";
import type { FaceRuntime } from "../context.js";
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";

type PresentableTool = Pick<ToolDefinition, "presentCall" | "presentResult">;

/** Face seq is 1-based index into the full session log. */
export function eventAtFaceSeq(
  events: readonly SessionEvent[],
  seq: number,
): SessionEvent | undefined {
  if (!Number.isInteger(seq) || seq < 1 || seq > events.length) return undefined;
  return events[seq - 1];
}

/**
 * Collect FileDiffs for one turn by replaying tool presenters over the log.
 */
export function collectTurnFileDiffs(
  events: readonly SessionEvent[],
  turnId: string,
  getTool: (name: string) => PresentableTool | undefined,
): FileDiff[] {
  const callsById = new Map<
    string,
    { readonly name: string; readonly arguments: unknown }
  >();
  const out: FileDiff[] = [];
  for (const ev of events) {
    if (ev.type === "tool/call" && ev.turnId === turnId) {
      callsById.set(ev.call.id, {
        name: ev.call.name,
        arguments: ev.call.arguments,
      });
      continue;
    }
    if (ev.type !== "tool/result" || ev.turnId !== turnId) continue;
    const call = callsById.get(ev.result.toolCallId);
    if (!call) continue;
    out.push(
      ...fileDiffsFromToolPresenters({
        name: call.name,
        args: call.arguments,
        result: ev.result,
        getTool,
      }),
    );
  }
  return out;
}

export function resolveWorkspaceFileDiff(input: {
  readonly events: readonly SessionEvent[];
  readonly seq: number;
  readonly index: number;
  readonly getTool: (name: string) => PresentableTool | undefined;
}): WorkspaceFileDiff | undefined {
  const ev = eventAtFaceSeq(input.events, input.seq);
  if (!ev || ev.type !== "workspace/changes") return undefined;
  const file = ev.summary.files[input.index];
  if (!file) return undefined;
  const diffs = collectTurnFileDiffs(
    input.events,
    ev.turnId,
    input.getTool,
  );
  return workspaceFileDiffForListedFile({ file, diffs });
}

/** DSH-style `changes.fileDiff` — `{ sessionId, seq, index }` → diff or null. */
export const changesFileDiff: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  const sessionId = String(
    args.sessionId ?? flat.sessionId ?? args.agentId ?? flat.agentId ?? "",
  ).trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  const seqRaw = args.seq ?? flat.seq;
  const indexRaw = args.index ?? flat.index;
  const seq = typeof seqRaw === "number" ? seqRaw : Number(seqRaw);
  const index = typeof indexRaw === "number" ? indexRaw : Number(indexRaw);
  if (!Number.isInteger(seq) || seq < 1) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "seq must be a positive integer" },
    };
  }
  if (!Number.isInteger(index) || index < 0) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "index must be a non-negative integer",
      },
    };
  }
  const events = readSessionEvents(runtime.store, sessionId);
  const getTool = (name: string): PresentableTool | undefined =>
    runtime.getTool?.(sessionId, name);
  const diff = resolveWorkspaceFileDiff({
    events,
    seq,
    index,
    getTool,
  });
  return { ok: true, value: { diff: diff ?? null } };
};

/** Test helper — same resolution without Face envelope. */
export function changesFileDiffForRuntime(
  runtime: FaceRuntime,
  sessionId: string,
  seq: number,
  index: number,
): WorkspaceFileDiff | null {
  const events = readSessionEvents(runtime.store, sessionId);
  const diff = resolveWorkspaceFileDiff({
    events,
    seq,
    index,
    getTool: (name) => runtime.getTool?.(sessionId, name),
  });
  return diff ?? null;
}
