/**
 * agent-desktop session + presentation cursor-overlay lifecycle.
 *
 * Product: every CLI call shares one session so refs and the visual cursor
 * stay coherent; `session start --cursor` turns on the overlay that shows
 * where the agent is acting (optional `--label` intent text).
 */

export interface SessionScopeState {
  sessionId: string | undefined;
  overlayEnabled: boolean;
}

/** Minimal CLI envelope slice used when parsing `session start`. */
export interface SessionStartEnvelope {
  readonly data?: unknown;
}

export interface SessionScopeOptions {
  readonly enableSession?: boolean;
  readonly sessionName?: string;
  readonly cursorOverlay?: boolean;
  readonly overlayLabel?: string;
  readonly agentId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseSessionId(envelope: SessionStartEnvelope): string | undefined {
  const data = asRecord(envelope.data);
  if (!data) return undefined;
  if (typeof data.session_id === "string" && data.session_id.length > 0) {
    return data.session_id;
  }
  const activation = asRecord(data.activation);
  if (typeof activation?.value === "string" && activation.value.length > 0) {
    return activation.value;
  }
  return undefined;
}

/**
 * Prefix global CLI flags for an active session (and optional agent-id).
 * `session start` itself must not pass a prior --session.
 */
export function withSessionFlags(
  args: readonly string[],
  state: SessionScopeState,
  options: SessionScopeOptions,
): string[] {
  const out = [...args];
  if (state.sessionId) {
    out.unshift("--session", state.sessionId);
  }
  const agentId = options.agentId?.trim();
  if (agentId) {
    out.unshift("--agent-id", agentId);
  }
  return out;
}

export function buildSessionStartArgs(
  options: SessionScopeOptions,
): string[] {
  const args = ["session", "start"];
  const name = options.sessionName?.trim() || "xrk-harness";
  args.push("--name", name);
  if (options.cursorOverlay !== false) {
    args.push("--cursor");
  }
  return args;
}

export function buildOverlayEnableArgs(label?: string): string[] {
  const args = ["cursor-overlay", "enable"];
  const text = label?.trim();
  if (text) {
    args.push("--label", text);
  }
  return args;
}

export function buildOverlayDisableArgs(): string[] {
  return ["cursor-overlay", "disable"];
}

export function buildSessionEndArgs(): string[] {
  return ["session", "end"];
}
