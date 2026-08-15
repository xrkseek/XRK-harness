import type { ToolCall } from "./tools.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessageBase {
  readonly role: ChatRole;
  readonly content: string;
}

export interface SystemMessage extends ChatMessageBase {
  readonly role: "system";
}

export interface UserMessage extends ChatMessageBase {
  readonly role: "user";
}

export interface AssistantMessage extends ChatMessageBase {
  readonly role: "assistant";
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolMessage extends ChatMessageBase {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly name?: string;
  readonly isError?: boolean;
}

export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;
