/**
 * Model- and UI-facing Face error text.
 * `error.code` stays machine-stable; `message` is a sentence.
 * A bare id is never a message — {@link formatToolError} expands leftovers.
 */

export interface FaceErrorLike {
  readonly code: string;
  readonly message: string;
}

export function sessionNotFoundMessage(sessionId: string): string {
  return `Session ${sessionId} was not found.`;
}

export function queueItemNotFoundMessage(itemId: string): string {
  return `Queue item ${itemId} was not found in this session.`;
}

export function approvalNotFoundMessage(approvalId: string): string {
  return `Approval ${approvalId} is not pending.`;
}

export function entryNotFoundMessage(entryId: string): string {
  return `Entry ${entryId} was not found.`;
}

const BARE_ID = /^[A-Za-z0-9_.:-]{4,}$/;

function expandBare(code: string, id: string): string {
  switch (code) {
    case "session-not-found":
      return sessionNotFoundMessage(id);
    case "queue-item-not-found":
      return queueItemNotFoundMessage(id);
    case "approval-not-found":
      return approvalNotFoundMessage(id);
    case "not-found":
      return entryNotFoundMessage(id);
    case "subagent-not-found":
      return `No child ${id} under this parent. Use an id from list_agents or subagent.`;
    case "subagent-not-resumable":
      return `Child ${id} is not continuable. followup_task and send_message need a continuable child; one-shot sessions are read-only.`;
    case "subagent-parent-unavailable":
      return `Parent session ${id} is gone; cannot reach its children.`;
    default:
      return id ? `${code} (${id})` : code;
  }
}

/** Tool-card / model text: `code: sentence`. Expands a message that is only an id. */
export function formatToolError(error: FaceErrorLike): string {
  const code = error.code.trim() || "error";
  const message = error.message.trim();
  const sentence =
    message && !BARE_ID.test(message)
      ? message
      : expandBare(code, message);
  if (sentence === code || sentence.startsWith(`${code}:`)) return sentence;
  return `${code}: ${sentence}`;
}
