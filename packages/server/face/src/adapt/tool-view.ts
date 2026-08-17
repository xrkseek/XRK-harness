/**
 * Host-owned tool event views — non-persisted, recomputed on mux/history.
 * Shape matches DeepSeek `ToolEventView`: `{ for, view: { card, ... } }`.
 */

import type { SessionEvent } from "@xrkseek/protocol";

export type ToolEventView =
  | {
      readonly for: "call";
      readonly view: {
        readonly card: "generic";
        readonly title: string;
        readonly content?: string;
      };
    }
  | {
      readonly for: "result";
      readonly view: {
        readonly card: "generic";
        readonly title: string;
        readonly content?: string;
      };
    };

const PREVIEW_MAX = 240;

function previewText(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_MAX) return t;
  return `${t.slice(0, PREVIEW_MAX - 1)}…`;
}

export function presentToolView(
  event: SessionEvent,
): ToolEventView | undefined {
  if (event.type === "tool/call") {
    let argsPreview: string;
    try {
      argsPreview = previewText(JSON.stringify(event.call.arguments ?? {}));
    } catch {
      argsPreview = "[unserializable]";
    }
    return {
      for: "call",
      view: {
        card: "generic",
        title: event.call.name,
        content: argsPreview,
      },
    };
  }
  if (event.type === "tool/result") {
    return {
      for: "result",
      view: {
        card: "generic",
        title: event.result.name,
        content: previewText(event.result.content),
      },
    };
  }
  return undefined;
}
