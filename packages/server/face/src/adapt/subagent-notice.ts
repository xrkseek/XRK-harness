import type { SessionEvent, TurnEndReason } from "@xrkseek/protocol";
import type { FaceSubagentLink } from "../subagent-registry.js";

/**
 * Child body text for parent-facing completion / tool results.
 *
 * Only `assistant/message.content` (or text `assistant/chunk`s). Never
 * `reasoning` / reasoning chunks — parent providers must not receive the
 * child's CoT in the next request (DSH settlement keeps text blocks only;
 * Codex: reasoning never enters the parent session).
 */
export function lastAssistantBodyText(
  events: readonly SessionEvent[],
): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "assistant/message") {
      const text = ev.content.trim();
      if (text) return text;
      // Empty body with reasoning-only (or tool-only) turn: keep searching;
      // never fall through to ev.reasoning.
      continue;
    }
  }

  // Incomplete turn: fold text chunks only (skip reasoning / usage / tool-call).
  let stepId: string | undefined;
  let folded = "";
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type !== "assistant/chunk") continue;
    if (stepId === undefined) stepId = ev.stepId;
    else if (ev.stepId !== stepId) break;
    const kind = ev.kind ?? "text";
    if (kind !== "text") continue;
    folded = ev.text + folded;
  }
  return folded.trim();
}

/** Latest `turn/end.reason` on the child log (undefined when still open). */
export function lastTurnEndReason(
  events: readonly SessionEvent[],
): TurnEndReason | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "turn/end") return ev.reason;
  }
  return undefined;
}

/**
 * What the child's model request was doing when the parent gave up: mid
 * provider retry (attempt n/max, code, backoff) or nothing at all. A parent
 * reading only "timed out" cannot tell a rate-limited child from one wedged
 * on a tool, and answers them differently. Undefined once the retry wait
 * already elapsed — that is a completed retry, not a diagnosis.
 */
export function lastModelRetryNotice(
  events: readonly SessionEvent[],
): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "llm/retry-started") return undefined;
    if (ev.type !== "llm/retry") continue;
    const budget = ev.maxRetries !== undefined
      ? `${ev.retry}/${ev.maxRetries}`
      : `${ev.retry}`;
    const status = ev.failure.status !== undefined
      ? ` status ${ev.failure.status}`
      : "";
    const wait = Math.round(ev.delayMs / 1000);
    const head = `Child was mid model-retry: attempt ${budget} (${ev.failure.code}${status})`;
    const via = ev.provider !== undefined ? ` via ${ev.provider}` : "";
    const backoff = wait >= 1 ? `, ${wait}s backoff` : `, ${ev.delayMs}ms backoff`;
    return `${head}${via}${backoff}.`;
  }
  return undefined;
}

function abnormalHeadDetail(reason: TurnEndReason): string | undefined {
  if (reason.kind === "aborted") {
    const cause = reason.reason;
    if (cause.kind === "user") return "aborted by user";
    if (cause.kind === "parent") return "aborted by parent";
    if (cause.kind === "disposed") return "aborted: session disposed";
    if (cause.kind === "hook") return `aborted by hook: ${cause.reason}`;
    if (cause.kind === "legacy") return "aborted";
    return "aborted";
  }
  if (reason.kind === "error") return "ended with error";
  if (reason.kind === "interrupted") return "interrupted mid-turn";
  if (reason.kind === "max-tokens") return "stopped at max tokens";
  if (reason.kind === "blocked") return "blocked";
  if (reason.kind === "forked") return "closed for fork";
  return undefined;
}

export type ChildOutcomeKind = TurnEndReason["kind"] | "none";
export type ChildAbortCause =
  | "user"
  | "parent"
  | "disposed"
  | "hook"
  | "legacy";

export interface ChildOutcome {
  readonly kind: ChildOutcomeKind;
  /** Set only for `kind: "aborted"` — who cut the turn off. */
  readonly cause?: ChildAbortCause;
  /** Ms since the child's last event; undefined for a session with no log. */
  readonly quietMs?: number;
}

/**
 * How a child's last turn ended, structurally. One source for both consumers:
 * the model-facing `list_agents` row (see {@link formatChildOutcome}) and the
 * catalog RPC the client renders.
 */
export function describeChildOutcome(
  events: readonly SessionEvent[],
  now: number = Date.now(),
): ChildOutcome {
  const last = events[events.length - 1];
  const quietMs = last ? Math.max(0, now - last.ts) : undefined;
  const quiet = quietMs !== undefined ? { quietMs } : {};
  const reason = lastTurnEndReason(events);
  if (reason === undefined) return { kind: "none", ...quiet };
  if (reason.kind === "aborted") {
    const cause = reason.reason;
    return {
      kind: "aborted",
      cause:
        cause.kind === "user" ||
        cause.kind === "parent" ||
        cause.kind === "disposed" ||
        cause.kind === "hook"
          ? cause.kind
          : "legacy",
      ...quiet,
    };
  }
  return { kind: reason.kind, ...quiet };
}

/**
 * How a child's last turn actually ended, plus how long it has been quiet.
 *
 * `activity: idle` alone cannot tell a finished child from one the parent's
 * wait budget cut off — both read as "inactive" in the roster, so a parent
 * reviewing its own tree reads a kill as a completion.
 */
export function formatDescribedChildOutcome(outcome: ChildOutcome): string {
  const { kind, cause, quietMs } = outcome;
  const verdict =
    kind === "none"
      ? "turn still open"
      : kind === "aborted"
        ? `aborted ${cause === "parent" ? "by parent" : cause === "user" ? "by user" : cause === "disposed" ? "(session disposed)" : cause === "hook" ? "(by hook)" : "(unknown source)"}`
        : kind === "completed"
          ? "finished"
          : kind === "error"
            ? "ended with error"
            : kind === "interrupted"
              ? "interrupted mid-turn"
              : kind === "max-tokens"
                ? "stopped at max tokens"
                : "blocked";
  const quiet =
    quietMs === undefined
      ? "no events"
      : quietMs < 90_000
        ? `${Math.round(quietMs / 1000)}s ago`
        : `${Math.round(quietMs / 60_000)}m ago`;
  return `${verdict} · last event ${quiet}`;
}

export function formatChildOutcome(
  events: readonly SessionEvent[],
  now: number = Date.now(),
): string {
  return formatDescribedChildOutcome(describeChildOutcome(events, now));
}

/** Steps / tool results already spent on the child — so the parent can judge sunk cost. */
export function childProgressLine(
  events: readonly SessionEvent[],
): string | undefined {
  let steps = 0;
  let toolResults = 0;
  let chars = 0;
  for (const ev of events) {
    if (ev.type === "step/end") steps += 1;
    if (ev.type === "tool/result") toolResults += 1;
    if (ev.type === "assistant/message" && ev.content.trim()) {
      chars += ev.content.trim().length;
    }
  }
  if (steps === 0 && toolResults === 0 && chars === 0) return undefined;
  const parts: string[] = [];
  if (steps > 0) parts.push(`${steps} step${steps === 1 ? "" : "s"}`);
  if (toolResults > 0) {
    parts.push(`${toolResults} tool result${toolResults === 1 ? "" : "s"}`);
  }
  if (chars > 0) {
    parts.push(
      chars >= 1000
        ? `~${Math.round(chars / 1000)}k chars written`
        : `${chars} chars written`,
    );
  }
  return `Already ran: ${parts.join(", ")}.`;
}

/** Why a continuable child was cut off before a natural turn end. */
export type SubagentStopReason = "user" | "parent" | "takeover";

/** Loop-injected user messages `继续` already written into this child log. */
export function autoContinueRounds(events: readonly SessionEvent[]): number {
  let count = 0;
  for (const ev of events) {
    if (ev.type === "user/message" && ev.source?.kind === "auto-continue") {
      count += 1;
    }
  }
  return count;
}

function resumeHint(
  outcome: ChildOutcome,
  events: readonly SessionEvent[],
  stop?: SubagentStopReason,
): string {
  const idHint = "Reuse the same agent_id — do not spawn a duplicate worker.";
  if (stop === "takeover") {
    return (
      "Task is paused for a human. Open the child session in the UI, or " +
      `send_message to resume as the model. list_agents shows status. ${idHint}`
    );
  }
  if (outcome.kind === "max-tokens") {
    const rounds = autoContinueRounds(events);
    const sent = rounds > 0
      ? `The child already sent "继续" as a user message ${rounds} time(s) inside this turn and still hit the output cap, so the turn stopped.`
      : 'The child hit the output cap and did not auto-send "继续" (auto-continue off, or this truncation never entered continuation).';
    return (
      `${sent} If you still need the rest, call send_message(agent_id, "继续") ` +
      `for another turn. session_read / list_agents shows what it already wrote. ${idHint}`
    );
  }
  if (
    stop !== undefined ||
    outcome.kind === "aborted" ||
    outcome.kind === "interrupted" ||
    outcome.kind === "none"
  ) {
    return (
      "Child session and transcript are kept. send_message to resume, " +
      `wait_agent if you need the next answer, or list_agents. ${idHint}`
    );
  }
  if (outcome.kind === "error" || outcome.kind === "blocked") {
    return (
      "Inspect with session_read / list_agents, then send_message to recover " +
      `or interrupt_agent when done. ${idHint}`
    );
  }
  return "Follow up with send_message, interrupt_agent when done, or list_agents.";
}

function assembleParentNotice(
  head: string,
  events: readonly SessionEvent[],
  answerBody: string | undefined,
  follow: string,
): string {
  const progress = childProgressLine(events);
  const outcome = formatDescribedChildOutcome(describeChildOutcome(events));
  const retry = lastModelRetryNotice(events);
  const preview = (answerBody !== undefined
    ? answerBody
    : lastAssistantBodyText(events)).trim();
  const lines = [head];
  if (progress) lines.push(progress);
  lines.push(`Outcome: ${outcome}.`);
  if (retry) lines.push(retry);
  if (preview) {
    lines.push("", "Partial / last answer:", preview, "");
  } else {
    lines.push("");
  }
  lines.push(follow);
  return lines.join("\n");
}

/**
 * Parent inbox notice when a human steers / queues into a continuable child
 * (UI composer or `subagent.prompt`). Tool-originated follow-ups skip this —
 * the parent already owns that text in its tool call.
 */
export function formatSubagentUserPromptNotice(
  link: FaceSubagentLink,
  preview: string,
): string {
  const label = link.label?.trim() || "subagent";
  const body = preview.trim();
  const clipped =
    body.length > 800 ? `${body.slice(0, 800).trimEnd()}…` : body;
  const head =
    `User message to background subagent \`${link.childSessionId}\` (${label}):`;
  return clipped ? `${head}\n\n${clipped}` : head;
}

/**
 * Parent inbox notice when a child is stopped on purpose.
 * Distinct from {@link formatSubagentCompletionNotice}: Stop / interrupt_agent
 * / takeover each say who cut the turn, so the parent does not read a kill as
 * "finished a turn".
 */
export function formatSubagentStopNotice(
  link: FaceSubagentLink,
  reason: SubagentStopReason,
  events: readonly SessionEvent[],
  answerBody?: string,
): string {
  const why =
    reason === "user"
      ? "stopped by the user (Stop on the child session)"
      : reason === "takeover"
        ? "paused for human takeover"
        : "interrupted by the parent (interrupt_agent)";
  const head = `background subagent \`${link.childSessionId}\` (${link.label}) ${why}.`;
  const outcome = describeChildOutcome(events);
  return assembleParentNotice(
    head,
    events,
    answerBody,
    resumeHint(outcome, events, reason),
  );
}

/**
 * Parent inbox notice when a background (continuable) child drain goes idle.
 * Normal idle → "finished a turn". Abnormal `turn/end` (abort / error / …)
 * still reports back with a clear head so the parent can recover — except when
 * Face suppressed delivery (e.g. `interrupt_agent` / explicit suppress).
 * Parent Stop does **not** cascade-cancel delegated workers.
 *
 * @param answerBody - optional already-bound child answer (see
 *   {@link boundChildAnswer}). When omitted, the raw last assistant text is
 *   inlined with **no** 2k hard clip — callers that need size control must
 *   pass a bound body so long answers spill instead of being silently cut.
 */
export function formatSubagentCompletionNotice(
  link: FaceSubagentLink,
  events: readonly SessionEvent[],
  answerBody?: string,
): string {
  const turnReason = lastTurnEndReason(events);
  const abnormal = turnReason ? abnormalHeadDetail(turnReason) : undefined;
  const head = abnormal
    ? `background subagent \`${link.childSessionId}\` (${link.label}) ended abnormally (${abnormal}).`
    : `background subagent \`${link.childSessionId}\` (${link.label}) finished a turn.`;
  const outcome = describeChildOutcome(events);
  return assembleParentNotice(
    head,
    events,
    answerBody,
    resumeHint(outcome, events),
  );
}
