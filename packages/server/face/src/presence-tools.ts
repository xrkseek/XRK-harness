/**
 * `presence_set` — AI drives the Overview emotion ball for this session.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import {
  formatPresenceEmotionToolHint,
  isKnownPresenceEmotionId,
} from "./presence-emotions.js";

export interface BindPresenceToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
}

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  // Keep the first instance. resolveAgent rebinds Face tools every open;
  // replace() minting a new object identity makes materializeTools settle
  // return "Stale tool call: presence_set" mid-turn.
  if (tools.get(tool.name)) return;
  tools.register(tool);
}

function readArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

/** Register `presence_set` on a live agent tool registry. */
export function bindPresenceTools(
  tools: ToolRegistry,
  options: BindPresenceToolsOptions,
): void {
  const { runtime, sessionId } = options;
  const catalogHint = formatPresenceEmotionToolHint();

  registerTool(tools, {
    name: "presence_set",
    description:
      "Set this session's Overview emotion ball. Call naturally when your mood " +
      "about the work shifts — do not wait for the user to ask. Prefer the full " +
      `catalog (not only a few favorites): ${catalogHint}. ` +
      'Optional short tips (caption). Pass emotionId "auto" only to clear sticky ' +
      "mood and let activity-derived emotion take over.",
    parameters: {
      type: "object",
      properties: {
        emotionId: {
          type: "string",
          description:
            'Known emotion id from the catalog (e.g. "30", "16", "19") or "auto" to clear sticky override.',
        },
        tips: {
          type: "string",
          description: "Optional short caption shown under the ball (≤200 chars).",
        },
      },
      required: ["emotionId"],
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "presence_set",
      kind: "other",
      rawInput: args,
    }),
    async execute(args) {
      const a = readArgs(args);
      const rawId = String(a.emotionId ?? "").trim();
      const tips =
        typeof a.tips === "string" ? a.tips.trim().slice(0, 200) : undefined;

      if (!rawId) {
        return { content: "presence_set: emotionId required", isError: true };
      }

      if (rawId.toLowerCase() === "auto") {
        runtime.presence.clear(sessionId);
        return {
          content: JSON.stringify({
            sessionId,
            emotionId: "auto",
            cleared: true,
          }),
        };
      }

      if (!isKnownPresenceEmotionId(rawId)) {
        return {
          content:
            `presence_set: unknown emotionId "${rawId}". Use a catalog id or "auto". Catalog: ${catalogHint}`,
          isError: true,
        };
      }

      const state = runtime.presence.set(sessionId, {
        emotionId: rawId,
        ...(tips ? { tips } : {}),
      });
      return {
        content: JSON.stringify({
          sessionId,
          emotionId: state.emotionId,
          ...(state.tips ? { tips: state.tips } : {}),
          source: state.source,
          updatedAt: state.updatedAt,
        }),
      };
    },
  });
}
