/**
 * Terminal projection of Face mux frames for `xrkh tui`.
 * Stream deltas + tool rail + approval capture (dsh-tui-style thin CLI; not Ink).
 */

import type { PendingApproval } from "./tui-commands.js";
import { createTuiPalette, type TuiPalette } from "./tui-style.js";

export interface ToolRailEntry {
  readonly callId: string;
  readonly name: string;
  status: "running" | "ok" | "error";
  detail?: string;
}

export interface TuiRenderState {
  /** True while streaming assistant text for the current turn. */
  streamingText: boolean;
  /** When true, dim reasoning chunks appear on the stream. */
  showReasoning: boolean;
  readonly tools: Map<string, ToolRailEntry>;
  pendingApproval?: PendingApproval | undefined;
  readonly palette: TuiPalette;
}

export function createTuiRenderState(
  palette: TuiPalette = createTuiPalette(),
): TuiRenderState {
  return {
    streamingText: false,
    showReasoning: false,
    tools: new Map(),
    palette,
  };
}

export interface TuiWriter {
  write(text: string): void;
}

export interface HandleMuxResult {
  /** True when this session's turn ended (or slash command settled). */
  readonly turnIdle?: boolean;
  /** Approval frame just observed (also stored on state). */
  readonly approval?: PendingApproval;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolCallId(call: Record<string, unknown> | null): string {
  if (!call) return "tool";
  const id = call.id ?? call.callId ?? call.toolCallId;
  return typeof id === "string" && id.length > 0 ? id : "tool";
}

function toolCallName(call: Record<string, unknown> | null): string {
  if (!call) return "tool";
  const name = call.name ?? call.toolName;
  return typeof name === "string" && name.length > 0 ? name : "tool";
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function endStreamLine(out: TuiWriter, state: TuiRenderState): void {
  if (state.streamingText) {
    out.write("\n");
    state.streamingText = false;
  }
}

function writeToolRail(
  out: TuiWriter,
  entry: ToolRailEntry,
  palette: TuiPalette,
): void {
  const mark =
    entry.status === "running"
      ? palette.warning("…")
      : entry.status === "ok"
        ? palette.success("ok")
        : palette.error("ERR");
  const name = palette.dim(entry.name);
  const detail = entry.detail
    ? palette.dim(`  ${truncate(entry.detail, 80)}`)
    : "";
  out.write(`  ${palette.dim("▸")} ${name}  ${mark}${detail}\n`);
}

function approvalFromFrame(
  frame: Record<string, unknown>,
): PendingApproval | undefined {
  const approvalId =
    typeof frame.approvalId === "string"
      ? frame.approvalId
      : typeof frame.id === "string"
        ? frame.id
        : undefined;
  if (!approvalId) return undefined;
  const toolName =
    typeof frame.toolName === "string" && frame.toolName.length > 0
      ? frame.toolName
      : "tool";
  let reason: string | undefined;
  if (typeof frame.reason === "string") {
    reason = frame.reason;
  } else if (typeof frame.displayReason === "string") {
    reason = frame.displayReason;
  } else {
    const dr = asRecord(frame.displayReason);
    if (dr && typeof dr.en === "string") reason = dr.en;
  }
  return {
    approvalId,
    toolName,
    ...(reason ? { reason } : {}),
  };
}

function writeApprovalNotice(
  out: TuiWriter,
  pending: PendingApproval,
  palette: TuiPalette,
): void {
  out.write(
    `  ${palette.warning("!")} ${palette.bold("approval")} ${pending.toolName}` +
      palette.dim(` id=${pending.approvalId}`) +
      "\n",
  );
  if (pending.reason) {
    out.write(`    ${palette.dim(truncate(pending.reason, 100))}\n`);
  }
  out.write(
    `    ${palette.accent("/approve")} · ${palette.accent("/deny")} · ${palette.accent("/whitelist")}\n`,
  );
}

function noteApproval(
  out: TuiWriter,
  state: TuiRenderState,
  frame: Record<string, unknown>,
): HandleMuxResult {
  endStreamLine(out, state);
  const pending = approvalFromFrame(frame);
  if (!pending) {
    out.write(
      `  ${state.palette.warning("!")} approval needed` +
        `  (${state.palette.accent("/cancel")})\n`,
    );
    return {};
  }
  state.pendingApproval = pending;
  writeApprovalNotice(out, pending, state.palette);
  return { approval: pending };
}

/**
 * Project one mux `payload` for `sessionId`. Ignores other sessions.
 */
export function handleMuxPayload(
  sessionId: string,
  payload: unknown,
  out: TuiWriter,
  state: TuiRenderState,
): HandleMuxResult {
  const frame = asRecord(payload);
  if (!frame) return {};
  if (frame.sessionId !== sessionId) return {};

  if (frame.type === "approval/requested") {
    return noteApproval(out, state, frame);
  }

  if (frame.type === "approval/resolved") {
    state.pendingApproval = undefined;
    return {};
  }

  if (frame.type === "question/requested") {
    endStreamLine(out, state);
    out.write(
      `  ${state.palette.warning("!")} question pending ` +
        `${state.palette.dim("(answer in product UI)")}\n`,
    );
    return {};
  }

  if (frame.type !== "session/event") return {};

  const event = asRecord(frame.event);
  if (!event || typeof event.type !== "string") return {};

  switch (event.type) {
    case "assistant/chunk": {
      const kind = typeof event.kind === "string" ? event.kind : "text";
      if (kind === "usage" || kind === "tool-call") return {};
      if (kind === "reasoning") {
        if (!state.showReasoning) return {};
        const text = typeof event.text === "string" ? event.text : "";
        if (!text) return {};
        endStreamLine(out, state);
        out.write(`  ${state.palette.dim(`~ ${truncate(text, 120)}`)}\n`);
        return {};
      }
      const text = typeof event.text === "string" ? event.text : "";
      if (!text) return {};
      state.streamingText = true;
      out.write(text);
      return {};
    }
    case "assistant/message": {
      endStreamLine(out, state);
      return {};
    }
    case "tool/call": {
      endStreamLine(out, state);
      const call = asRecord(event.call);
      const id = toolCallId(call);
      const name = toolCallName(call);
      const entry: ToolRailEntry = { callId: id, name, status: "running" };
      state.tools.set(id, entry);
      writeToolRail(out, entry, state.palette);
      return {};
    }
    case "tool/result": {
      endStreamLine(out, state);
      const callId =
        typeof event.callId === "string"
          ? event.callId
          : typeof event.toolCallId === "string"
            ? event.toolCallId
            : undefined;
      const existing = callId ? state.tools.get(callId) : undefined;
      const name =
        existing?.name ??
        (typeof event.name === "string" ? event.name : "tool");
      const id = callId ?? existing?.callId ?? name;
      const err = asRecord(event.error);
      const isErr = Boolean(err) || event.isError === true;
      let detail: string | undefined;
      if (isErr && err) {
        detail =
          typeof err.message === "string"
            ? err.message
            : typeof err.code === "string"
              ? err.code
              : undefined;
      } else if (typeof event.content === "string") {
        detail = event.content;
      }
      const entry: ToolRailEntry = {
        callId: id,
        name,
        status: isErr ? "error" : "ok",
        ...(detail ? { detail } : {}),
      };
      state.tools.set(id, entry);
      writeToolRail(out, entry, state.palette);
      return {};
    }
    case "command/result": {
      endStreamLine(out, state);
      const text = typeof event.text === "string" ? event.text : "";
      if (text) out.write(`${text}\n`);
      return { turnIdle: true };
    }
    case "turn/end": {
      endStreamLine(out, state);
      const reason = typeof event.reason === "string" ? event.reason : "";
      if (reason && reason !== "completed" && reason !== "stop") {
        out.write(`  ${state.palette.dim(`(turn end: ${reason})`)}\n`);
      }
      state.tools.clear();
      return { turnIdle: true };
    }
    case "approval/asked":
      return noteApproval(out, state, event);
    case "approval/decided": {
      state.pendingApproval = undefined;
      return {};
    }
    default:
      return {};
  }
}

/** Format open tools for a status-line footer (optional). */
export function formatToolRailSummary(state: TuiRenderState): string {
  const running = [...state.tools.values()].filter((t) => t.status === "running");
  if (running.length === 0) return "";
  return running.map((t) => t.name).join(", ");
}
