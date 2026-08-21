import type { MessageContent } from "./content.js";
import type { ToolCall } from "./tools.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface SystemMessage {
  readonly role: "system";
  readonly content: string;
}

export interface UserMessage {
  readonly role: "user";
  /** Plain string or ContentBlock[] (text + image refs). */
  readonly content: MessageContent;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  /**
   * Model thinking / reasoning text. On every reasoned turn, pass back into
   * the next request as `reasoning_content` (DSH `dsh-v0.1.0-rc.8` /
   * `serializeAssistant`): required on tool-call turns; also kept on plain
   * turns so a gateway re-encoding for another vendor can hash the CoT.
   */
  readonly reasoning?: string;
}

export interface ToolMessage {
  readonly role: "tool";
  /** Plain string or ContentBlock[] (text + admitted image refs). */
  readonly content: MessageContent;
  readonly toolCallId: string;
  readonly name?: string;
  readonly isError?: boolean;
}

export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;
