import type { ChatMessage, MessageContent } from "@xrkseek/protocol";

export interface AssembledRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
}

export interface SkeletonSystemInput {
  readonly persona?: string;
  readonly mcpProtocol?: string;
}

export interface SkeletonUserInput {
  readonly text: string;
  /** Multimodal placeholder — ignored in M1 text path. */
  readonly attachments?: readonly unknown[];
}

export interface VolatileUserInput {
  readonly nowIso: string;
  readonly sessionId: string;
  readonly owner?: string;
}

export interface ThreeLayerInput {
  readonly skeletonSystem: SkeletonSystemInput;
  readonly history: readonly ChatMessage[];
  readonly skeletonUser: SkeletonUserInput;
  readonly volatile: VolatileUserInput;
  readonly tools?: AssembledRequest["tools"];
  readonly workspaceBlocks?: readonly string[];
  /**
   * When false, omit the `[current message]` marker (follow-up steps).
   * Leaving the marker after growing history moves it each step and busts
   * DeepSeek-style prompt-prefix cache for the conversation body.
   */
  readonly includeCurrentMarker?: boolean;
  /**
   * When false, omit `time:` from volatile (follow-up steps). Session id stays
   * so the volatile suffix can stay byte-stable across a turn's tool loop.
   */
  readonly includeVolatileTime?: boolean;
  /**
   * Optional tool wire order (DSH `toolOrder`). Exactly one `' '` rest marker;
   * named tools before/after the rest appear in that order, remaining tools
   * fill the rest slot in lexicographic order. Omit / empty → pure lex sort.
   * Unknown names, duplicates, or wrong rest count throw.
   */
  readonly toolOrder?: readonly string[];
}

export function buildSkeletonSystem(input: SkeletonSystemInput): string {
  const parts = [
    input.persona?.trim() || "You are a helpful coding agent.",
    input.mcpProtocol?.trim() || "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

export function buildSkeletonUser(input: SkeletonUserInput): ChatMessage {
  const attachmentNote =
    input.attachments && input.attachments.length > 0
      ? `\n\n[attachments: ${input.attachments.length} placeholder(s)]`
      : "";
  return {
    role: "user",
    content: `${input.text}${attachmentNote}`,
  };
}

export const VOLATILE_OPEN = "[volatile]";
export const VOLATILE_CLOSE = "[/volatile]";
export const CURRENT_MESSAGE_LABEL = "[current message]";

/** Zero-width / no-break spaces the loop uses as "no human text this step". */
const INVISIBLE_USER_FILLER = ["\u200b", "\u200c", "\u200d", "\ufeff", "\u00a0"];

/**
 * True when the live user turn actually carries human content.
 *
 * The agent loop sends `"\u200b"` (zero-width space) as a placeholder on
 * follow-up steps; treating that as a real turn is what made the model reply
 * to its own per-turn metadata.
 */
export function hasHumanUserText(text: string | undefined): boolean {
  if (text === undefined) return false;
  let out = text;
  for (const filler of INVISIBLE_USER_FILLER) out = out.split(filler).join("");
  return out.trim().length > 0;
}

/** Remove a volatile block (any position) from user text. */
export function stripVolatileBlock(content: string): string {
  const open = content.indexOf(VOLATILE_OPEN);
  if (open < 0) return content;
  const close = content.indexOf(VOLATILE_CLOSE, open);
  const end = close < 0 ? content.length : close + VOLATILE_CLOSE.length;
  return content.slice(0, open) + content.slice(end);
}

/** Concatenated text of message content (non-text blocks contribute nothing). */
export function textOfContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  let out = "";
  for (const block of content) if (block.type === "text") out += block.text;
  return out;
}

/**
 * True when the content carries what a human actually sent: visible text
 * (ignoring a folded volatile block and invisible filler), or an image / file
 * block.
 */
export function hasHumanMessageContent(
  content: MessageContent,
): boolean {
  if (typeof content !== "string" && content.some((b) => b.type !== "text")) {
    return true;
  }
  return hasHumanUserText(stripVolatileBlock(textOfContent(content)));
}

/**
 * A user message with no human content once its volatile block is removed --
 * i.e. turn machinery disguised as a user turn. Never send these.
 */
export function isMetadataOnlyUserMessage(m: ChatMessage): boolean {
  return m.role === "user" && !hasHumanMessageContent(m.content);
}

/**
 * Volatile block as a *string* -- meant to be appended to the tail of the live
 * user message (docs: volatile never enters `system`, and lives in the user
 * suffix), not to become its own turn.
 */
export function buildVolatileBlock(
  input: VolatileUserInput,
  options: { readonly includeTime?: boolean } = {},
): string {
  const includeTime = options.includeTime !== false;
  const lines = [
    ...(includeTime ? [`time: ${input.nowIso}`] : []),
    `session: ${input.sessionId}`,
  ];
  if (input.owner) lines.push(`owner: ${input.owner}`);
  return `${VOLATILE_OPEN}\n${lines.join("\n")}\n${VOLATILE_CLOSE}`;
}

/**
 * @deprecated Emits a standalone `user` message whose content is pure
 * metadata, which the model reads as "the human just spoke" and answers.
 * Use `buildVolatileBlock` and append it to the live user turn;
 * `assembleThreeLayers` no longer calls this.
 */
export function buildVolatileUser(
  input: VolatileUserInput,
  options: { readonly includeTime?: boolean } = {},
): ChatMessage {
  return {
    role: "user",
    content: buildVolatileBlock(input, options),
  };
}

/**
 * History transcript; optionally followed by a standalone `[current message]`
 * user turn.
 *
 * Avoid for assembly: that marker is a synthetic user turn, which reads to the
 * model as "the human just spoke". The assembler labels the live turn inline
 * instead (`CURRENT_MESSAGE_LABEL`).
 */
export function mergeHistory(
  history: readonly ChatMessage[],
  options: { readonly includeCurrentMarker?: boolean } = {},
): ChatMessage[] {
  if (history.length === 0) return [];
  const includeMarker = options.includeCurrentMarker !== false;
  if (!includeMarker) return [...history];
  return [
    ...history,
    {
      role: "user",
      content: "[current message]",
    },
  ];
}

/** Lexicographic tool order — registration order must not leak to the wire. */
export const TOOL_ORDER_REST = " " as const;

/**
 * Order tools for the wire.
 * @param tools - tool definitions for this request
 * @param toolOrder - optional DSH-style order with exactly one `' '` rest
 */
export function orderToolsForWire(
  tools: AssembledRequest["tools"],
  toolOrder?: readonly string[],
): AssembledRequest["tools"] {
  const lex = [...tools].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  if (!toolOrder || toolOrder.length === 0) return lex;

  const restMarks = toolOrder.filter((x) => x === TOOL_ORDER_REST);
  if (restMarks.length !== 1) {
    throw new Error(
      `toolOrder must contain exactly one ' ' rest marker (got ${restMarks.length})`,
    );
  }
  const named = toolOrder.filter((x) => x !== TOOL_ORDER_REST);
  if (new Set(named).size !== named.length) {
    throw new Error("toolOrder must not list the same tool name twice");
  }
  const byName = new Map(tools.map((t) => [t.name, t] as const));
  for (const name of named) {
    if (!byName.has(name)) {
      throw new Error(`toolOrder references unknown tool: ${name}`);
    }
  }
  const restIdx = toolOrder.indexOf(TOOL_ORDER_REST);
  const before = toolOrder.slice(0, restIdx).filter((x) => x !== TOOL_ORDER_REST);
  const after = toolOrder.slice(restIdx + 1).filter((x) => x !== TOOL_ORDER_REST);
  const pinned = new Set([...before, ...after]);
  const middle = lex.filter((t) => !pinned.has(t.name));
  const pick = (names: readonly string[]) =>
    names.map((n) => {
      const t = byName.get(n);
      if (!t) throw new Error(`toolOrder references unknown tool: ${n}`);
      return t;
    });
  return [...pick(before), ...middle, ...pick(after)];
}

/**
 * Fixed order:
 * 1. system = skeleton system (+ optional workspace blocks appended)
 * 2. messages = history + the live user turn, with the volatile block folded
 *    into its tail. Volatile never becomes a turn of its own: a `user` message
 *    that carries only metadata is read as the human speaking, and the model
 *    answers that instead of doing the work.
 * 3. follow-up steps (no human text) append nothing at all, so the request ends
 *    on the real transcript (assistant tool_calls / tool results).
 * Volatile content must never appear in `system`.
 * Tools are sorted by name (or `toolOrder`) for prompt-cache stability (DSH parity).
 */
export function assembleThreeLayers(
  input: ThreeLayerInput,
): AssembledRequest {
  const systemParts = [buildSkeletonSystem(input.skeletonSystem)];
  if (input.workspaceBlocks?.length) {
    systemParts.push(...input.workspaceBlocks);
  }
  const system = systemParts.filter((s) => s.trim()).join("\n\n");
  const hasAttachments = (input.skeletonUser.attachments?.length ?? 0) > 0;
  const includeTime = input.includeVolatileTime !== false;
  const volatileBlock = buildVolatileBlock(input.volatile, { includeTime });
  const messages: ChatMessage[] = [
    ...input.history,
  ];
  if (hasHumanUserText(input.skeletonUser.text) || hasAttachments) {
    messages.push({
      role: "user",
      content: [
        ...(input.includeCurrentMarker !== false
          ? [CURRENT_MESSAGE_LABEL]
          : []),
        buildSkeletonUser(input.skeletonUser).content,
        volatileBlock,
      ].join("\n\n"),
    });
  } else if (messages.length === 0) {
    // Cold start with no human text still needs one message on the wire.
    messages.push({ role: "user", content: volatileBlock });
  }
  return {
    system,
    messages,
    tools: orderToolsForWire(input.tools ?? [], input.toolOrder),
  };
}
