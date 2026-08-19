import type { SessionEvent } from "@xrkseek/protocol";
import { flattenText } from "@xrkseek/protocol";

/** Searchable plain text extracted from one session event (empty = skip index). */
export function extractEventSearchText(event: SessionEvent): string {
  if (event.type === "user/message") {
    return flattenText(event.content);
  }
  if (event.type === "assistant/message" && typeof event.content === "string") {
    return event.content;
  }
  if (event.type === "prompt/admitted") {
    return flattenText(event.content);
  }
  if (event.type === "safety/notice" && typeof event.content === "string") {
    return event.content;
  }
  if (event.type === "command/run") {
    return [event.name, event.args].filter(Boolean).join(" ");
  }
  if (event.type === "command/done" && typeof event.text === "string") {
    return event.text;
  }
  if (event.type === "todo/write") {
    return event.todos.map((item) => item.content).filter(Boolean).join(" ");
  }
  if (event.type === "feedback/record") {
    return event.text;
  }
  return "";
}

export function extractSessionSearchTexts(events: readonly SessionEvent[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    const text = extractEventSearchText(event);
    if (text) out.push(text);
  }
  return out;
}
