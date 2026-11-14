/**
 * Adapt `@xrkseek/xrk-tools` definitions (DSH `defineTool` shape after remap)
 * into `@xrkseek/core-tools` ToolDefinition for Host registry remount.
 *
 * Shapes differ: xrk returns a canonical JSON value + `output.render`;
 * core-tools returns `{ content }` for the settle pipeline.
 */
import type { ToolDefinition as CoreToolDefinition } from "@xrkseek/core-tools";
import {
  isImageMediaType,
  type ContentBlock,
  type MessageContent,
} from "@xrkseek/protocol";
import type { ToolDefinition as XrkToolDefinition } from "@xrkseek/xrk-tools";

function asCoreContent(blocks: readonly unknown[]): MessageContent {
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const row = block as Record<string, unknown>;
    if (row.type === "text" && typeof row.text === "string") {
      out.push({
        type: "text",
        text: row.text,
        ...(row.modelOnly === true ? { modelOnly: true as const } : {}),
      });
      continue;
    }
    if (row.type === "image" && row.attachment && typeof row.attachment === "object") {
      const att = row.attachment as Record<string, unknown>;
      const attachmentId =
        typeof att.attachmentId === "string" ? att.attachmentId : "";
      const mediaType = isImageMediaType(att.mediaType)
        ? att.mediaType
        : "image/gif";
      const bytes = typeof att.bytes === "number" ? att.bytes : 0;
      const width = typeof att.width === "number" ? att.width : 0;
      const height = typeof att.height === "number" ? att.height : 0;
      if (!attachmentId) continue;
      out.push({
        type: "image",
        attachment: { attachmentId, mediaType, bytes, width, height },
      });
    }
  }
  return out.length > 0 ? out : "";
}

function stubXrkExec(
  name: string,
  args: unknown,
  signal: AbortSignal,
  extras?: {
    readonly callId?: string;
    concludeTurn?: () => void;
    deferContext?: (text: string) => void;
  },
): {
  callId: string;
  rootCallId: string;
  name: string;
  arguments: unknown;
  signal: AbortSignal;
  token: symbol;
  deferContext: (context: unknown) => void;
  concludeTurn: () => void;
} {
  const callId = extras?.callId?.trim() || `community:${name}`;
  return {
    callId,
    rootCallId: callId,
    name,
    arguments: args,
    signal,
    token: Symbol(`community-tool:${name}`),
    deferContext(context) {
      if (typeof extras?.deferContext !== "function") return;
      if (typeof context === "string") {
        extras.deferContext(context);
        return;
      }
      if (context && typeof context === "object") {
        const text = (context as { content?: unknown }).content;
        if (typeof text === "string") extras.deferContext(text);
      }
    },
    concludeTurn() {
      extras?.concludeTurn?.();
    },
  };
}

/**
 * Convert one remapped DSH/`xrk-tools` definition into a Host registry tool.
 */
export function adaptXrkToolToCore(
  tool: XrkToolDefinition,
): CoreToolDefinition {
  const name = tool.name;
  return {
    name,
    description: tool.description,
    parameters:
      tool.parameters && typeof tool.parameters === "object"
        ? tool.parameters
        : { type: "object", properties: {} },
    async execute(args, signal, extras) {
      const ac = new AbortController();
      const merged = signal ?? ac.signal;
      try {
        const value = await tool.execute(
          args,
          stubXrkExec(name, args, merged, extras) as never,
        );
        const rendered = tool.output.render(args, value as never);
        const content = asCoreContent(
          Array.isArray(rendered) ? rendered : [],
        );
        return {
          content: content === "" ? String(value ?? "") : content,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "tool failed");
        return { content: message, isError: true };
      }
    },
    ...(typeof tool.isConcurrencySafe === "function"
      ? {
          isConcurrencySafe(args: unknown) {
            try {
              return tool.isConcurrencySafe!(args) === true;
            } catch {
              return false;
            }
          },
        }
      : {}),
    ...(typeof tool.presentCall === "function"
      ? {
          presentCall(args: unknown) {
            try {
              return tool.presentCall!(args);
            } catch {
              return undefined;
            }
          },
        }
      : {}),
  };
}
