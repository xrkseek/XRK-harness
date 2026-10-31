/**
 * Channel prefixes on delegated-child admits.
 *
 * Labels come from live Settings (`titleBoss` / `titleManager` / `titleAgent`
 * or a titleScheme × locale) — never hardcode 老板/经理/干员 in prefixes.
 *
 * Layers (roles; names are user-defined):
 * - Project: human_face → manager seat (no channel prefix on the parent).
 * - Tool child of project: parent tool → `[manager…]`; UI → `[boss…]`.
 * - Agent-home: human_face → agent seat (no channel prefix on the home).
 * - Tool child of agent-home / nested: parent tool → `[agent…]`; UI → `[boss…]`.
 *
 * Paths: `session.prompt` (UI) = human_face; `subagent.prompt` from
 * tool-/orch- rpc = parent; UUID rpc through subagent.prompt = human_face.
 */

import type { MessageContent } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import {
  bossSeatLabelFromRuntime,
  resolveChildParentSeat,
} from "./seat-identity.js";
import {
  readSeatTitles,
  readUiLocalePreference,
} from "./seat-titles.js";

/** Who authored this admit into a delegated child. */
export type SeatChannel = "human_face" | "parent";

/** Parse Face payload `seatChannel`; default human_face (UI composer). */
export function parseSeatChannel(raw: unknown): SeatChannel {
  return raw === "parent" ? "parent" : "human_face";
}

/** `[titles.boss…]` / `[titles.manager…]` — model-visible channel marker. */
export function formatSeatChannelPrefix(label: string): string {
  const name = label.trim() || "?";
  return `[${name}]`;
}

/**
 * Prepend a seat channel marker unless the text already carries one.
 * @param label - formal seat (+ nickname) of the author.
 * @param text - admit body.
 */
export function withSeatChannelPrefix(label: string, text: string): string {
  const body = text.trimStart();
  if (!body) return text;
  const prefix = formatSeatChannelPrefix(label);
  if (body.startsWith(prefix)) return text;
  // Already tagged with any `[Seat] ` channel — do not double-wrap.
  if (/^\[[^\]]+\]\s/.test(body)) return text;
  return `${prefix} ${body}`;
}

/**
 * Resolve the label for a channel on a delegated child.
 * human_face → Settings boss title; parent → immediate parent seat label.
 */
export function resolveSeatChannelLabel(
  runtime: FaceRuntime,
  childSessionId: string,
  channel: SeatChannel,
): string {
  // One Settings read — titles are user-defined (scheme / titleBoss…).
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const titles = readSeatTitles(
    presenceUser,
    readUiLocalePreference(localeUser),
  );
  if (channel === "human_face") {
    return bossSeatLabelFromRuntime(runtime, titles);
  }
  const link = runtime.subagents.getByChild(childSessionId);
  if (!link || link.mode === "fork") return titles.manager;
  return resolveChildParentSeat(runtime, link.parentSessionId, titles).label;
}

/**
 * Apply channel prefix when admitting into a tool-delegated child.
 * Forks and non-children are unchanged.
 */
export function maybePrefixDelegatedChildText(
  runtime: FaceRuntime,
  sessionId: string,
  text: string,
  channel: SeatChannel,
): string {
  const link = runtime.subagents.getByChild(sessionId);
  if (!link || link.mode === "fork") return text;
  const label = resolveSeatChannelLabel(runtime, sessionId, channel);
  return withSeatChannelPrefix(label, text);
}

/**
 * Prefix string or first non-empty text block of MessageContent.
 * Attachment-only admits (no text) stay unchanged.
 */
export function maybePrefixDelegatedChildContent(
  runtime: FaceRuntime,
  sessionId: string,
  content: MessageContent,
  channel: SeatChannel,
): MessageContent {
  if (typeof content === "string") {
    return maybePrefixDelegatedChildText(runtime, sessionId, content, channel);
  }
  let done = false;
  return content.map((block) => {
    if (done || block.type !== "text" || !block.text.trim()) return block;
    done = true;
    return {
      ...block,
      text: maybePrefixDelegatedChildText(
        runtime,
        sessionId,
        block.text,
        channel,
      ),
    };
  });
}
