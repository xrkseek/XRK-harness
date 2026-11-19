/**
 * Durable `user/message.source` builders for seat speech + handoffs.
 * Every admit that is not the human UI composer must stamp a non-`user` source
 * so Overview / transcript can classify 委派方 · 协作对端 · 回传.
 */

import type { UserMessageSource } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { sessionSeatMemberId } from "./agent-home-boundary.js";
import { resolveChildParentSeat } from "./seat-identity.js";
import {
  readSeatTitles,
  readUiLocalePreference,
} from "./seat-titles.js";
import type { SeatChannel } from "./seat-channel.js";
import type { FaceSubagentLink } from "./subagent-registry.js";
import { readSessionOpener } from "./session-opener.js";

function seatTitlesOf(runtime: FaceRuntime) {
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  return readSeatTitles(
    presenceUser,
    readUiLocalePreference(localeUser),
  );
}

/**
 * Resolve durable speech source for `session.prompt` / tool steers.
 * - human_face → `{ kind: "user" }` (老板)
 * - parent / peer → `{ kind: "seat", form: "speech", … }` with real fromSessionId
 */
export function buildAdmitSpeechSource(
  runtime: FaceRuntime,
  sessionId: string,
  channel: SeatChannel,
  fromSessionIdRaw?: string,
): UserMessageSource {
  if (channel === "human_face") {
    return { kind: "user" };
  }

  const titles = seatTitlesOf(runtime);
  const uiLocale = readUiLocalePreference(
    runtime.settingsNamespaces.view("locale").value as Record<string, unknown>,
  );

  let fromSessionId = (fromSessionIdRaw ?? "").trim();
  if (!fromSessionId && channel === "parent") {
    const child = runtime.subagents.getByChild(sessionId);
    if (child && child.mode !== "fork") {
      fromSessionId = child.parentSessionId;
    } else {
      fromSessionId = readSessionOpener(runtime, sessionId)?.sourceSessionId ?? "";
    }
  }
  if (!fromSessionId) {
    // Last resort: still mark as seat speech so we never forge `kind:"user"`.
    fromSessionId = sessionId;
  }

  const seat = resolveChildParentSeat(
    runtime,
    fromSessionId,
    titles,
    uiLocale,
  );
  const memberId =
    seat.memberId?.trim()
    || sessionSeatMemberId(runtime, fromSessionId)?.trim()
    || undefined;
  const label = seat.label?.trim() || undefined;

  return {
    kind: "seat",
    form: "speech",
    channel: channel === "peer" ? "peer" : "parent",
    fromSessionId,
    ...(memberId ? { memberId } : {}),
    ...(label ? { label } : {}),
  };
}

/** Subagent completion / stop steer into the parent. */
export function subagentHandoffSource(
  link: FaceSubagentLink,
): UserMessageSource {
  return {
    kind: "handoff",
    form: "notice",
    via: "subagent",
    fromSessionId: link.childSessionId,
    ...(link.label ? { label: link.label } : {}),
    ...(link.memberId ? { memberId: link.memberId } : {}),
  };
}

/** Resolve seat label / memberId for a peer / thread session (durable handoff chrome). */
function peerSeatMeta(
  runtime: FaceRuntime,
  sessionId: string,
): { readonly label?: string; readonly memberId?: string } {
  const titles = seatTitlesOf(runtime);
  const uiLocale = readUiLocalePreference(
    runtime.settingsNamespaces.view("locale").value as Record<string, unknown>,
  );
  const seat = resolveChildParentSeat(runtime, sessionId, titles, uiLocale);
  const memberId =
    seat.memberId?.trim()
    || sessionSeatMemberId(runtime, sessionId)?.trim()
    || undefined;
  const label = seat.label?.trim() || undefined;
  return {
    ...(memberId ? { memberId } : {}),
    ...(label ? { label } : {}),
  };
}

/** Peer-collab completion / stop steer into the waiter. */
export function peerCollabHandoffSource(
  runtime: FaceRuntime,
  peerSessionId: string,
): UserMessageSource {
  const id = peerSessionId.trim();
  const meta = peerSeatMeta(runtime, id);
  return {
    kind: "handoff",
    form: "notice",
    via: "peer-collab",
    fromSessionId: id,
    ...meta,
  };
}

/** 主线 peer cut-off notice. */
export function threadStopHandoffSource(
  runtime: FaceRuntime,
  stoppedSessionId: string,
): UserMessageSource {
  const id = stoppedSessionId.trim();
  const meta = peerSeatMeta(runtime, id);
  return {
    kind: "handoff",
    form: "notice",
    via: "thread-stop",
    fromSessionId: id,
    ...meta,
  };
}

/** Boss mood broadcast — not human speech into the target session. */
export function bossStatusBroadcastSource(): UserMessageSource {
  return {
    kind: "plugin",
    plugin: "boss-status",
    form: "notice",
  };
}
