import {
  TOOL_ABORTED,
  TOOL_ABORTED_MESSAGE,
} from "@xrkseek/protocol";
import type { ToolResultContent } from "./definition.js";

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException || err instanceof Error) &&
    err.name === "AbortError"
  );
}

/** Model-facing result when cancel wins after the tool body was invoked. */
export function abortedToolContent(): ToolResultContent {
  return {
    content: TOOL_ABORTED_MESSAGE,
    isError: true,
    error: { name: "AbortError", code: TOOL_ABORTED },
  };
}
