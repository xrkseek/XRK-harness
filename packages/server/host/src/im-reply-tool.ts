/**
 * IM tool surface for `ws_im` / agentPreset `im`.
 * Outbound is tool-driven only (text + image/video/file/audio). Ports are
 * injectable so AGT (or other hosts) can replace send/lookup without forking
 * the tool defs.
 */
import type {
  ToolDefinition,
  ToolRegistry,
  ToolResultContent,
} from "@xrkseek/core-tools";
import {
  lookupImSessionBySessionId,
  normalizeImAttachments,
  sendImMessage,
  type ImAttachment,
  type ImSessionMapEntry,
} from "@xrkseek/server-http";

export type ImSendRequest = {
  readonly channel: string;
  readonly chatKey: string;
  readonly sessionId: string;
  readonly text: string;
  readonly attachments?: readonly ImAttachment[];
  readonly botId?: string;
  readonly raw?: Record<string, unknown>;
};

export type ImSendResult = Record<string, unknown>;

/** Replaceable I/O used by default IM tools (AGT can override). */
export interface ImToolPorts {
  lookupBinding(
    sessionId: string,
    xrkHome?: string,
  ): ImSessionMapEntry | undefined;
  send(
    request: ImSendRequest,
    xrkHome?: string,
  ): ImSendResult | Promise<ImSendResult>;
}

const defaultPorts: ImToolPorts = {
  lookupBinding(sessionId, xrkHome) {
    return lookupImSessionBySessionId(xrkHome, sessionId);
  },
  send(request, xrkHome) {
    return sendImMessage(xrkHome, request.channel, {
      text: request.text,
      chatKey: request.chatKey,
      sessionId: request.sessionId,
      ...(request.botId ? { botId: request.botId } : {}),
      ...(request.attachments?.length
        ? { attachments: [...request.attachments] }
        : {}),
      ...(request.raw ? { ...request.raw } : {}),
    });
  },
};

/** Process-wide port overrides (Host / AGT set once at boot). */
let globalPorts: Partial<ImToolPorts> | undefined;

export function setImToolPorts(ports: Partial<ImToolPorts> | undefined): void {
  globalPorts = ports;
}

export function resolveImToolPorts(
  local?: Partial<ImToolPorts>,
): ImToolPorts {
  return {
    lookupBinding:
      local?.lookupBinding ??
      globalPorts?.lookupBinding ??
      defaultPorts.lookupBinding,
    send: local?.send ?? globalPorts?.send ?? defaultPorts.send,
  };
}

export interface CreateImToolDefinitionsOptions {
  readonly sessionId: string;
  readonly xrkHome?: string;
  /** Per-session / per-bind port overrides (win over {@link setImToolPorts}). */
  readonly ports?: Partial<ImToolPorts>;
  /** Register `im_reply` as alias of `im_send` (default true). */
  readonly replyAlias?: boolean;
  /**
   * Mutate or replace the default defs before bind (AGT: rename, wrap execute,
   * drop tools, inject vendor fields).
   */
  readonly mapTools?: (
    tools: readonly ToolDefinition[],
  ) => readonly ToolDefinition[];
  /** Extra tools appended after defaults (and after mapTools). */
  readonly extraTools?: readonly ToolDefinition[];
}

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  if (tools.get(tool.name)) return;
  tools.register(tool);
}

function readArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

function bindingOrError(
  ports: ImToolPorts,
  sessionId: string,
  xrkHome: string | undefined,
): ImSessionMapEntry | { error: string } {
  const binding = ports.lookupBinding(sessionId, xrkHome);
  if (!binding) {
    return { error: "no IM chat binding for this session" };
  }
  return binding;
}

/**
 * Build default IM tool definitions (does not register). Downstream can map
 * then register, or pass through {@link bindImTools}.
 */
export function createImToolDefinitions(
  options: CreateImToolDefinitionsOptions,
): ToolDefinition[] {
  const { sessionId, xrkHome } = options;
  const ports = resolveImToolPorts(options.ports);
  const replyAlias = options.replyAlias !== false;

  const sendTool: ToolDefinition = {
    name: "im_send",
    description:
      "Send a message to the IM chat bound to this Face session. " +
      "Supports plain text and attachments (image / video / file / audio). " +
      "This is the only outbound path — the Host does not auto-post assistant text. " +
      "Call when the user-facing IM client should see a reply, status, or media. " +
      "Desktop and Web show the same Face ws_im transcript; vendor delivery uses " +
      "the Host bridge / AGT ports / sidecar. " +
      "Provide text and/or attachments (at least one). " +
      "Pass final=true after the last message so the turn ends (no further model step).",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Plain text delivered to the IM channel. Optional when attachments are present.",
        },
        attachments: {
          type: "array",
          description:
            "Media to deliver with the message. Each item needs kind " +
            "(image|video|file|audio) and at least one of url, path, attachmentId, or name.",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                description: "image | video | file | audio",
              },
              name: { type: "string", description: "Display / file name." },
              mediaType: {
                type: "string",
                description: "MIME type when known (e.g. image/png, video/mp4).",
              },
              url: {
                type: "string",
                description: "Remote URL the sidecar / vendor can fetch.",
              },
              path: {
                type: "string",
                description: "Absolute local path on the Host / Desktop.",
              },
              attachmentId: {
                type: "string",
                description:
                  "Face AttachmentStore id when bytes already live in-process.",
              },
              bytes: { type: "number", description: "Byte size when known." },
              caption: {
                type: "string",
                description: "Optional caption for this attachment.",
              },
            },
            required: ["kind"],
            additionalProperties: false,
          },
        },
        final: {
          type: "boolean",
          description:
            "When true, conclude the agent turn after a successful send.",
        },
      },
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "im_send",
      kind: "other",
      rawInput: args,
    }),
    async execute(args): Promise<ToolResultContent> {
      const a = readArgs(args);
      const text = typeof a.text === "string" ? a.text.trim() : "";
      const attachments = normalizeImAttachments({
        ...(typeof a.attachments !== "undefined"
          ? { attachments: a.attachments }
          : {}),
      });
      if (!text && attachments.length === 0) {
        return {
          content: "im_send: text or attachments required",
          isError: true,
        };
      }
      const binding = bindingOrError(ports, sessionId, xrkHome);
      if ("error" in binding) {
        return { content: `im_send: ${binding.error}`, isError: true };
      }
      const out = await ports.send(
        {
          channel: binding.channel,
          chatKey: binding.chatKey,
          sessionId,
          text,
          ...(attachments.length ? { attachments } : {}),
        },
        xrkHome,
      );
      const final = a.final === true;
      return {
        content: JSON.stringify({ ...out, chatKey: binding.chatKey }),
        ...(final ? { concludesTurn: true as const } : {}),
      };
    },
  };

  const defs: ToolDefinition[] = [sendTool];

  if (replyAlias) {
    defs.push({
      ...sendTool,
      name: "im_reply",
      description:
        "Alias of im_send — deliver text and/or media to the bound IM chat. Prefer im_send.",
      presentCall: (args) => ({
        card: "generic",
        title: "im_reply",
        kind: "other",
        rawInput: args,
      }),
    });
  }

  defs.push({
    name: "im_binding",
    description:
      "Read which IM channel/chatKey this Face session is bound to. " +
      "Use before im_send when unsure of the destination.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({
      card: "generic",
      title: "im_binding",
      kind: "other",
      rawInput: {},
    }),
    async execute(): Promise<ToolResultContent> {
      const binding = bindingOrError(ports, sessionId, xrkHome);
      if ("error" in binding) {
        return { content: `im_binding: ${binding.error}`, isError: true };
      }
      return {
        content: JSON.stringify({
          sessionId,
          channel: binding.channel,
          chatKey: binding.chatKey,
          updatedAt: binding.updatedAt,
        }),
      };
    },
  });

  const mapped = options.mapTools ? [...options.mapTools(defs)] : defs;
  if (options.extraTools?.length) {
    return [...mapped, ...options.extraTools];
  }
  return mapped;
}

/**
 * Register IM tools on a session registry.
 * Prefer {@link createImToolDefinitions} when AGT needs to inspect/edit first.
 */
export function bindImTools(
  tools: ToolRegistry,
  options: CreateImToolDefinitionsOptions,
): void {
  for (const tool of createImToolDefinitions(options)) {
    registerTool(tools, tool);
  }
}

/** @deprecated Prefer {@link bindImTools}. */
export const bindImReplyTool = bindImTools;
