/**
 * Capture a reusable 干员 playbook from a session log.
 */
import { readSessionEvents } from "@xrkseek/core-session";
import { flattenText, type SessionEvent } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import { MEMBER_NAME_MAX, MEMBER_PLAYBOOK_MAX } from "./agent-roster-store.js";

function lastUserTexts(events: readonly SessionEvent[], limit = 3): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const ev = events[i]!;
    if (ev.type !== "user/message") continue;
    const text = flattenText(ev.content).trim();
    if (text) out.unshift(text);
  }
  return out;
}

export function captureSessionPlaybook(
  runtime: FaceRuntime,
  sessionId: string,
): { name: string; playbook: string } | undefined {
  const events = readSessionEvents(runtime.store, sessionId);
  const users = lastUserTexts(events);
  if (users.length === 0) return undefined;
  const goal = users[0]!.replace(/\s+/g, " ").trim();
  const name = goal.slice(0, MEMBER_NAME_MAX) || "会话干员";
  const assistant = lastAssistantBodyText(events).slice(0, 2_400);
  const playbook = [
    "You are a reusable workspace 干员 captured from a finished session.",
    "Follow this workflow for the next TASK without rediscovering the process.",
    "",
    "GOAL (from the human):",
    users.join("\n---\n"),
    "",
    ...(assistant
      ? ["HOW YOU WORKED (evidence, truncated):", assistant]
      : ["HOW YOU WORKED: not yet written; infer from GOAL and the TASK."]),
  ]
    .join("\n")
    .slice(0, MEMBER_PLAYBOOK_MAX);
  return { name, playbook };
}
