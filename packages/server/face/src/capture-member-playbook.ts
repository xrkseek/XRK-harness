/**
 * Optional draft fill when minting omits name/playbook — recent user lines only.
 * Primary mint path: author playbook from the real scenario + materials
 * (skills/files); do not treat chat capture as "training a 干员".
 * Advanced packs append portable path guidance for 公文包 (briefcase).
 */
import { readSessionEvents } from "@xrkseek/core-session";
import { flattenText, type SessionEvent } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { lastAssistantBodyText } from "./adapt/subagent-notice.js";
import { MEMBER_NAME_MAX, MEMBER_PLAYBOOK_MAX } from "./agent-roster-store.js";
import { MEMBER_PACK_BRIEFCASE } from "./agent-member-pack.js";

/** Injected into advanced playbooks so zip-share stays path-portable. */
export const ADVANCED_PACK_PATHS_SECTION = [
  "## Paths (portable)",
  `Session cwd = parent's coding workspace. Your ${MEMBER_PACK_BRIEFCASE} is separate — read/edit there or copy into the workspace.`,
  `Inside ${MEMBER_PACK_BRIEFCASE}: materials → \`workspace/\` · skills → \`skills/<id>/\` (incl. references/) · env → \`env/SETUP.md\`. Relative paths only when sharing the zip — never absolute host paths.`,
].join("\n");

/** Append portable PATHS once (idempotent). */
export function withAdvancedPackPathGuidance(playbook: string): string {
  const trimmed = playbook.trim();
  if (!trimmed) return ADVANCED_PACK_PATHS_SECTION.slice(0, MEMBER_PLAYBOOK_MAX);
  if (
    /##\s*Paths\s*\(portable\)/i.test(trimmed) ||
    /PATHS\s*\(portable/i.test(trimmed)
  ) {
    return trimmed.slice(0, MEMBER_PLAYBOOK_MAX);
  }
  return `${trimmed}\n\n${ADVANCED_PACK_PATHS_SECTION}\n`.slice(
    0,
    MEMBER_PLAYBOOK_MAX,
  );
}

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
  const name = goal.slice(0, MEMBER_NAME_MAX) || "干员";
  const assistant = lastAssistantBodyText(events).slice(0, 2_400);
  const playbook = [
    "You are a reusable workspace 干员 for a concrete scenario.",
    "Follow this workflow for the next TASK; refine the playbook if it is only a draft stub.",
    "",
    "SCENARIO (from recent user asks — draft only):",
    users.join("\n---\n"),
    "",
    ...(assistant
      ? ["NOTES (truncated evidence — rewrite into durable steps when minting properly):", assistant]
      : ["NOTES: none yet — write real steps from materials/skills when minting."]),
  ]
    .join("\n")
    .slice(0, MEMBER_PLAYBOOK_MAX);
  return { name, playbook };
}
