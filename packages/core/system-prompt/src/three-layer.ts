import type { ChatMessage } from "@xrkseek/protocol";

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

export function buildVolatileUser(input: VolatileUserInput): ChatMessage {
  const lines = [
    `time: ${input.nowIso}`,
    `session: ${input.sessionId}`,
  ];
  if (input.owner) lines.push(`owner: ${input.owner}`);
  return {
    role: "user",
    content: `[volatile]\n${lines.join("\n")}`,
  };
}

/** History transcript + current-message marker before the live user turn. */
export function mergeHistory(
  history: readonly ChatMessage[],
): ChatMessage[] {
  if (history.length === 0) return [];
  return [
    ...history,
    {
      role: "user",
      content: "[current message]",
    },
  ];
}

/**
 * Fixed order:
 * 1. system = skeleton system (+ optional workspace blocks appended)
 * 2. messages = history(+marker) + skeleton user + volatile user
 * Volatile content must never appear in `system`.
 */
export function assembleThreeLayers(
  input: ThreeLayerInput,
): AssembledRequest {
  const systemParts = [buildSkeletonSystem(input.skeletonSystem)];
  if (input.workspaceBlocks?.length) {
    systemParts.push(...input.workspaceBlocks);
  }
  const system = systemParts.filter((s) => s.trim()).join("\n\n");
  const messages: ChatMessage[] = [
    ...mergeHistory(input.history),
    buildSkeletonUser(input.skeletonUser),
    buildVolatileUser(input.volatile),
  ];
  return {
    system,
    messages,
    tools: input.tools ?? [],
  };
}
