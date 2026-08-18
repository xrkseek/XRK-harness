/**
 * DSH `host/remote-event` — verbatim allowlisted Host events for the
 * captured shell `ctx.remote.$dispatch`. Cordis inspect/run events are
 * not forwarded (no Cordis apply).
 */

import type { FaceBus } from "./bus.js";
import type { HostFrame } from "./types.js";

export const FACE_HOST_REMOTE_EVENTS = [
  "agent-preset/selected",
  "commands/change",
  "credentials/updated",
  "llm/adapters-updated",
  "settings/document-updated",
] as const;

export type FaceHostRemoteEvent = (typeof FACE_HOST_REMOTE_EVENTS)[number];

const ALLOWED = new Set<string>(FACE_HOST_REMOTE_EVENTS);

export type FaceRemoteArg = string | number | boolean | null;

export function publishRemoteEvent(
  bus: Pick<FaceBus, "publishHost">,
  event: FaceHostRemoteEvent,
  args: readonly FaceRemoteArg[] = [],
): void {
  if (!ALLOWED.has(event)) return;
  const frame: HostFrame = {
    type: "host/remote-event",
    event,
    args: [...args],
  };
  bus.publishHost(frame);
}
