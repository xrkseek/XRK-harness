import { Buffer } from "node:buffer";
import type {
  GenericCallView,
  TerminalCallView,
  TerminalResultView,
} from "@xrkseek/core-tools";
import { clipUtf8Head, clipUtf8Tail } from "./bytes.js";
import type {
  TerminalReadResult,
  TerminalSendRead,
  TerminalSendResult,
  TerminalSessionSnapshot,
  TerminalSpawnResult,
} from "./types.js";

export const DEFAULT_MAX_RESULT_BYTES = 256 * 1024;
export const MIN_MAX_RESULT_BYTES = 64;

const TRUNCATED = "\n[output truncated]";

function byteLength(text: string): number {
  return Buffer.byteLength(text);
}

function fitWithSuffix(
  content: string,
  suffix: string,
  maxBytes: number,
): string {
  const fixedBytes = byteLength(suffix);
  if (fixedBytes >= maxBytes) return clipUtf8Tail(suffix, maxBytes).text;
  return `${clipUtf8Tail(content, maxBytes - fixedBytes).text}${suffix}`;
}

function fitWithPrefix(
  prefix: string,
  content: string,
  maxBytes: number,
): string {
  const fixed = `${prefix}${TRUNCATED}`;
  const fixedBytes = byteLength(fixed);
  if (fixedBytes >= maxBytes) return clipUtf8Head(fixed, maxBytes).text;
  return `${prefix}${clipUtf8Tail(content, maxBytes - fixedBytes).text}${TRUNCATED}`;
}

function boundBodyWithSuffix(
  content: string,
  metadata: string,
  upstreamTruncated: boolean,
  maxBytes: number,
): string {
  const suffix = `${metadata}${upstreamTruncated ? TRUNCATED : ""}`;
  const complete = `${content}${suffix}`;
  if (byteLength(complete) <= maxBytes) return complete;
  return fitWithSuffix(content, `${metadata}${TRUNCATED}`, maxBytes);
}

export function boundTerminalText(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const markerBytes = byteLength(TRUNCATED);
  if (markerBytes >= maxBytes) return clipUtf8Tail(TRUNCATED, maxBytes).text;
  return `${clipUtf8Head(text, maxBytes - markerBytes).text}${TRUNCATED}`;
}

export function renderSpawn(
  result: TerminalSpawnResult,
  maxBytes: number,
): string {
  const label =
    result.name === undefined
      ? result.sessionId
      : `${result.sessionId} (${result.name})`;
  const prefix = `started terminal session ${label} [type: ${result.type}]\n`;
  const motd = result.motd || "(no startup output)";
  const complete = `${prefix}${motd}`;
  return byteLength(complete) <= maxBytes
    ? complete
    : fitWithPrefix(prefix, motd, maxBytes);
}

function sessionStatusLine(status: TerminalSessionSnapshot["status"]): string {
  return status.kind === "running"
    ? "running"
    : `exited code=${status.exitCode ?? "null"} signal=${status.signal ?? "null"}`;
}

export function renderSend(
  result: TerminalSendResult,
  maxBytes: number,
): string {
  const output = result.viewport || "(no new output)";
  return boundBodyWithSuffix(
    output,
    `\n[wait: ${result.waitReason}]\n[session: ${sessionStatusLine(result.sessionStatus)}]`,
    result.truncated,
    maxBytes,
  );
}

export function renderSendRead(read: TerminalSendRead): string {
  const separator =
    read.delta.endsWith("\n") || read.delta.length === 0 ? "" : "\n";
  return `${read.delta}${read.truncated ? `${separator}[output truncated]` : ""}`;
}

export function renderRead(
  result: TerminalReadResult,
  maxBytes: number,
): string {
  const output = result.text || "(no retained output)";
  return boundBodyWithSuffix(
    output,
    `\n[lines: ${result.lineBegin}-${result.lineEnd} of ${result.totalLines}]`,
    result.truncated,
    maxBytes,
  );
}

export function renderList(
  sessions: readonly TerminalSessionSnapshot[],
  maxBytes: number,
): string {
  if (sessions.length === 0) return "(no terminal sessions)";
  const text = sessions
    .map((session) => {
      const name = session.name === undefined ? "" : ` (${session.name})`;
      const pid = session.pid === undefined ? "" : ` pid=${session.pid}`;
      return `${session.sessionId}${name} [${session.type}] ${sessionStatusLine(session.status)}${pid}`;
    })
    .join("\n");
  return boundBodyWithSuffix(text, "", false, maxBytes);
}

export const PTY_PROMPT_TEXT =
  "Use a terminal session only when work needs persistent terminal state or interactive stdin; prefer shell/read/write/edit for bounded one-shot operations. Terminal ids look like `pty-1` from terminal_open / terminal_list — never reuse the chat session id (`sess_…`) from the volatile block. Track every terminal session id and close sessions that no longer matter. An inferred_idle or timeout result does not prove the foreground command exited. Use run_in_background on terminal_send for fire-and-forget; collect with job_output or stop with job_kill.";

export function presentOpenCall(args: {
  type?: string;
  name?: string;
}): GenericCallView {
  return {
    card: "generic",
    title: `Open terminal ${args.name ?? args.type ?? "shell"}`,
    kind: "execute",
  };
}

export function presentSendCall(args: {
  sessionId?: string;
  text?: string;
  run_in_background?: boolean;
}): TerminalCallView | GenericCallView {
  if (args.run_in_background === true) {
    return {
      card: "generic",
      title: `Send to terminal ${args.sessionId ?? ""} in background`,
      kind: "execute",
      rawInput: args.text,
    };
  }
  return {
    card: "terminal",
    title: args.text || "(send input)",
    description: `Terminal ${args.sessionId ?? ""}`,
  };
}

export function presentSendResult(
  _args: unknown,
  result: { readonly content: string; readonly isError?: boolean },
): TerminalResultView | undefined {
  if (result.isError) return undefined;
  return { card: "terminal", output: result.content };
}
