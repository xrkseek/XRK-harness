/**
 * Seat channel helpers for delegated-child admits.
 *
 * Body text is no longer prefixed with `[老板]` / `[经理]` — transcript owner
 * is `user/message.source` (identity chip). Label helpers remain for Face
 * speech source builders / seat identity.
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

/**
 * Who authored this admit.
 * - human_face: UI composer (老板)
 * - parent: opener / subagent parent AI (委派方)
 * - peer: collab partner session (互为委派方)
 */
export type SeatChannel = "human_face" | "parent" | "peer";

/** Parse Face payload `seatChannel`; default human_face (UI composer). */
export function parseSeatChannel(raw: unknown): SeatChannel {
  if (raw === "parent") return "parent";
  if (raw === "peer") return "peer";
  return "human_face";
}

/**
 * Internal (seat / tool) rpc ids: `tool-` / `orch-` / `te-` / `delete-`.
 *
 * Everything else is a human pressing send through some UI — a client UUID, no
 * matter which device or which RPC carried it. The parent-inbox mirror keys off
 * this so a phone entering the child directly and a desktop delegating from the
 * parent seat both count as "the human spoke".
 */
export function isInternalFaceRpc(rpcId: string): boolean {
  return /^(tool-|orch-|te-|delete-)/.test(rpcId);
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
 * human_face → Settings boss title; parent → immediate parent seat label;
 * peer → manager title fallback (caller should prefer fromSession label).
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
  if (channel === "peer") {
    return titles.manager;
  }
  const link = runtime.subagents.getByChild(childSessionId);
  if (!link || link.mode === "fork") return titles.manager;
  return resolveChildParentSeat(runtime, link.parentSessionId, titles).label;
}

/**
 * Formerly prepended `[老板]` / `[经理]` into child admits. Transcript already
 * carries owner via `user/message.source` (identity chip) — keep the body
 * clean. Forks / non-children unchanged. Args retained so call sites stay stable.
 */
export function maybePrefixDelegatedChildText(
  _runtime: FaceRuntime,
  _sessionId: string,
  text: string,
  _channel: SeatChannel,
  _fromSessionId?: string,
): string {
  return text;
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
  fromSessionId?: string,
): MessageContent {
  if (typeof content === "string") {
    return maybePrefixDelegatedChildText(
      runtime,
      sessionId,
      content,
      channel,
      fromSessionId,
    );
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
        fromSessionId,
      ),
    };
  });
}
