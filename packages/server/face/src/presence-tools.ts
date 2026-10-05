/**
 * `presence_set` — AI drives the Overview emotion ball for this session.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import {
  formatPresenceEmotionToolHint,
  isKnownPresenceEmotionId,
} from "./presence-emotions.js";
import { publishSessionThread } from "./session-thread-publish.js";

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
  const child = Boolean(runtime.subagents.getByChild(sessionId));
  const description = child
    ? "Show this session's Overview emotion + 支线 caption (what you are doing now). Call when mood or work shifts — do not wait to be asked. "
      + `Prefer the catalog: ${catalogHint}. tips ≤200 chars. emotionId "auto" clears sticky mood.`
    : "Show this session's 支线: Overview emotion ball + a short caption of what you are doing now "
      + "(sidebar under the session name). Call when mood or current work shifts — do not wait to be asked. "
      + `Prefer the full catalog: ${catalogHint}. `
      + 'tips = 支线 (≤200 chars). Pass emotionId "auto" only to clear sticky mood.';

  registerTool(tools, {
    name: "presence_set",
    description,
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
          description: "支线 caption: what you are doing now (Overview + sidebar, ≤200 chars).",
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
      if (tips) {
        const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
        if (runtime.sessionThreads.bindOf(workspaceId, sessionId)) {
          runtime.sessionThreads.setSideline(workspaceId, sessionId, tips);
        }
        publishSessionThread(runtime, workspaceId, sessionId);
      }
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
