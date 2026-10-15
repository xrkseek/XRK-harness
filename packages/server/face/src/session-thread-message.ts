/**
 * Parent↔parent session collab: eligibility + the text Face injects on the peer.
 * 主线 is a discovery pin (collab board / thread_list), not a messaging gate.
 * Children stay on send_message / followup_task.
 */

export function peerThreadMessageProblem(input: {
  readonly selfId: string;
  readonly targetId: string;
  readonly targetExists: boolean;
  readonly targetIsChild: boolean;
}): string | undefined {
  const selfId = input.selfId.trim();
  const targetId = input.targetId.trim();
  if (!targetId) return "thread_message requires session_id";
  if (targetId === selfId) return "thread_message: cannot message this session";
  if (!input.targetExists) {
    return "thread_message: unknown session_id";
  }
  if (input.targetIsChild) {
    return "thread_message: target is a subagent — use send_message / followup_task";
  }
  return undefined;
}

export function formatPeerCollabPrompt(input: {
  readonly fromSessionId: string;
  readonly fromThreadTitle?: string;
  readonly message: string;
}): string {
  const pin = input.fromThreadTitle?.trim()
    ? ` (主线 「${input.fromThreadTitle.trim()}」)`
    : "";
  return [
    `[会话协作] From parent session ${input.fromSessionId}${pin}.`,
    "Your next assistant message is the reply they wait for. Do not spawn a subagent for this unless they asked you to.",
    "",
    input.message.trim(),
  ].join("\n");
}
