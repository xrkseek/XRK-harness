import type { SessionEvent } from "@xrkseek/protocol";
import type { ToolDefinition } from "./definition.js";
import type { ToolEventView } from "./presentation.js";

/** DSH apiproxy `argsFor` pairing: call name + parsed args. */
export interface ToolCallPairing {
  readonly name: string;
  readonly args: unknown;
}

export interface PresentToolLookup {
  getTool(
    name: string,
  ):
    | Pick<ToolDefinition, "presentCall" | "presentResult">
    | undefined;
  argsFor?(callId: string): ToolCallPairing | undefined;
}

/**
 * DSH apiproxy `viewFor`: look up the tool's presenters, never throw into
 * delivery. Missing pairing / presenter / throw → no view (client generic).
 */
export function presentToolEventView(
  event: SessionEvent,
  lookup: PresentToolLookup,
): ToolEventView | undefined {
  try {
    if (event.type === "tool/call") {
      const view = lookup.getTool(event.call.name)?.presentCall?.(
        event.call.arguments,
      );
      return view === undefined ? undefined : { for: "call", view };
    }
    if (event.type === "tool/result") {
      const call = lookup.argsFor?.(event.result.toolCallId);
      if (call === undefined) return undefined;
      const view = lookup.getTool(call.name)?.presentResult?.(call.args, {
        content: event.result.content,
        ...(event.result.isError ? { isError: true } : {}),
        ...(event.result.meta !== undefined ? { meta: event.result.meta } : {}),
      });
      return view === undefined ? undefined : { for: "result", view };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
