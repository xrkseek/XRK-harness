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
