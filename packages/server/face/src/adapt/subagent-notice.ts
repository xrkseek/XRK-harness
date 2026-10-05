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

/**
 * Parent inbox notice when a background (continuable) child drain goes idle.
 * Normal idle → "finished a turn". Abnormal `turn/end` (abort / error / …)
 * still reports back with a clear head so the parent can recover — except when
 * Face suppressed delivery after a **user** parent Stop (cascade cancel).
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
  const preview = (answerBody !== undefined
    ? answerBody
    : lastAssistantBodyText(events)).trim();
  const follow =
    "Follow up with send_message, interrupt_agent when done, or list_agents.";
  if (!preview) return `${head} ${follow}`;
  return `${head}\n\n${preview}\n\n${follow}`;
}
