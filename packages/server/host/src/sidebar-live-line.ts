/**
 * Fold session events into the Host sidebar `subagents.live` line.
 * Wire shape: {@link SidebarSubagentLiveActivity} (nested `tool`, not flat string).
 */
import type { SessionEvent } from "@xrkseek/protocol";
import type { SidebarSubagentLiveActivity } from "@xrkseek/server-http";

const TEXT_CAP = 200;
const ARGS_CAP = 120;

/** Pure: last assistant text and/or tool call for one child session. */
export function liveLineFromSessionEvents(
  events: readonly SessionEvent[],
): SidebarSubagentLiveActivity | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === "assistant/chunk") {
      if (ev.kind === "tool-call" && ev.toolName) {
        return {
          tool: {
            name: ev.toolName,
            args: ev.argumentsDelta
              ? ev.argumentsDelta.slice(0, ARGS_CAP)
              : "",
          },
        };
      }
      const text = ev.text?.trim();
      if (text) return { text: text.slice(0, TEXT_CAP) };
      continue;
    }
    if (ev.type === "assistant/message") {
      const text = ev.content?.trim();
      if (text) return { text: text.slice(0, TEXT_CAP) };
      continue;
    }
    if (ev.type === "tool/call") {
      const raw =
        typeof ev.call.arguments === "string"
          ? ev.call.arguments
          : JSON.stringify(ev.call.arguments ?? {});
      return {
        tool: {
          name: ev.call.name,
          args: raw.slice(0, ARGS_CAP),
        },
      };
    }
  }
  return undefined;
}
