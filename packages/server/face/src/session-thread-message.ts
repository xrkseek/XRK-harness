/**
 * Parent↔parent session collab + sibling child↔child under the same parent.
 * 主线 is a discovery pin (collab board / thread_list), not a messaging gate.
 * Parent→child stays on send_message / followup_task.
 */

/** True when both ids are delegated children of the same parent. */
export function sameDelegatedParent(
  selfParentId: string | undefined,
  targetParentId: string | undefined,
): boolean {
  const a = selfParentId?.trim();
  const b = targetParentId?.trim();
  return Boolean(a && b && a === b);
}

/** True when a team graph lists an undirected peer edge between the two sessions. */
export function teamPeerLinked(
  edges: readonly { readonly kind: string; readonly from: string; readonly to: string }[],
  selfId: string,
  targetId: string,
): boolean {
  for (const e of edges) {
    if (e.kind !== "peer") continue;
    if (
      (e.from === selfId && e.to === targetId) ||
      (e.from === targetId && e.to === selfId)
    ) {
      return true;
    }
  }
  return false;
}

export function peerThreadMessageProblem(input: {
  readonly selfId: string;
  readonly targetId: string;
  readonly targetExists: boolean;
  /** Target is a tool-delegated child (not a UI fork). */
  readonly targetIsChild: boolean;
  /**
   * Caller is also a delegated child and shares a parent with the target
   * (or a team `peer` edge). Then child↔child messaging is allowed.
   */
  readonly siblingOk?: boolean;
}): string | undefined {
  const selfId = input.selfId.trim();
  const targetId = input.targetId.trim();
  if (!targetId) return "thread_message requires session_id";
  if (targetId === selfId) return "thread_message: cannot message this session";
  if (!input.targetExists) {
    return "thread_message: unknown session_id";
  }
  if (input.targetIsChild && !input.siblingOk) {
    return "thread_message: target is a subagent — use send_message / followup_task (or sibling thread_message under the same parent)";
  }
  return undefined;
}

/**
 * Pin-mate broadcast when a collaborating session is cut off.
 * Waiters who armed via thread_message / workspace_session_prompt get the
 * richer stop handoff instead (see peer-collab-handoff) — do not double-speak.
 */
export function formatPeerCollabStopNotice(input: {
  readonly sessionId: string;
  readonly why: string;
}): string {
  return [
    `[会话协作] Session ${input.sessionId} ${input.why}.`,
    "Do not assume their work finished. thread_message again if you still need them.",
  ].join("\n");
}

export function formatPeerCollabPrompt(input: {
  readonly fromSessionId: string;
  readonly fromThreadTitle?: string;
  readonly message: string;
  /**
   * When true (wait:true), the peer is blocked on this turn's assistant text.
   * When false (wait:false / fire-and-forget), do not oblige a reply — that
   * framing caused courtesy acks to ping-pong via thread_message forever.
   */
  readonly awaitingReply?: boolean;
}): string {
  const pin = input.fromThreadTitle?.trim()
    ? ` (主线 「${input.fromThreadTitle.trim()}」)`
    : "";
  const awaiting = input.awaitingReply !== false;
  const duty = awaiting
    ? "Your next assistant message is the reply they wait for. Do not spawn a subagent for this unless they asked you to."
    : "Inbound note — they are not waiting on a reply. Do not thread_message / workspace_session_prompt back unless you have a new ask; courtesy acks cause ping-pong.";
  return [
    `[会话协作] From session ${input.fromSessionId}${pin}.`,
    duty,
    "",
    input.message.trim(),
  ].join("\n");
}
