/**
 * Terminal projection of Face mux frames for `xrkh tui`.
 * Stream deltas + a one-line tool rail (Hermes/Codex-style thin CLI; not Ink).
 */

export interface ToolRailEntry {
  readonly callId: string;
  readonly name: string;
  status: "running" | "ok" | "error";
  detail?: string;
}

export interface TuiRenderState {
  /** True while streaming assistant text for the current turn. */
  streamingText: boolean;
  readonly tools: Map<string, ToolRailEntry>;
}

export function createTuiRenderState(): TuiRenderState {
  return { streamingText: false, tools: new Map() };
}

export interface TuiWriter {
  write(text: string): void;
}

export interface HandleMuxResult {
  /** True when this session's turn ended (or slash command settled). */
  readonly turnIdle?: boolean;
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

function writeToolRail(out: TuiWriter, entry: ToolRailEntry): void {
  const mark =
    entry.status === "running" ? "…" : entry.status === "ok" ? "ok" : "ERR";
  const detail = entry.detail ? `  ${truncate(entry.detail, 80)}` : "";
  out.write(`  [tool] ${entry.name}  ${mark}${detail}\n`);
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
    endStreamLine(out, state);
    const tool =
      typeof frame.toolName === "string" ? frame.toolName : "tool";
    out.write(
      `  ! approval needed: ${tool} (respond in product UI, or /cancel)\n`,
    );
    return {};
  }

  if (frame.type === "question/requested") {
    endStreamLine(out, state);
    out.write("  ! question pending (respond in product UI)\n");
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
        // Keep the main stream clean; reasoning stays in the product shell.
        return {};
      }
      const text = typeof event.text === "string" ? event.text : "";
      if (!text) return {};
      if (!state.streamingText) {
        out.write("");
        state.streamingText = true;
      }
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
      writeToolRail(out, entry);
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
      writeToolRail(out, entry);
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
        out.write(`  (turn end: ${reason})\n`);
      }
      state.tools.clear();
      return { turnIdle: true };
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
