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
