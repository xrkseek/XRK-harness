import type {
  GenericCallView,
  TerminalCallView,
  TerminalResultView,
  GenericResultView,
  PresentableToolResult,
} from "@xrkseek/core-tools";
import { parseExitStatus } from "@xrkseek/core-tools";

/**
 * Present foreground calls as terminals and background starts as generic cards.
 * Copied from `@deepseek-ai/dsh-tool-bash` `presentBashCall` (`background` is
 * this repo's `run_in_background`).
 */
export function presentBashCall(
  args: unknown,
): GenericCallView | TerminalCallView | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as {
    command?: unknown;
    cwd?: unknown;
    background?: unknown;
  };
  if (typeof a.command !== "string" || !a.command.trim()) return undefined;
  if (a.background === true) {
    return {
      card: "generic",
      title: a.command,
      kind: "execute",
      rawInput: a.command,
    };
  }
  return {
    card: "terminal",
    title: a.command,
    ...(typeof a.cwd === "string" && a.cwd.trim() ? { cwd: a.cwd } : {}),
  };
}

/**
 * Present completed foreground output as a terminal; background acknowledgements
 * and execution errors use generic fenced output without an exit-status pill.
 * Copied from `@deepseek-ai/dsh-tool-bash` `presentBashResult`.
 */
export function presentBashResult(
  args: unknown,
  result: PresentableToolResult,
): TerminalResultView | GenericResultView | undefined {
  const raw = result.content;
  const isBackground =
    typeof args === "object" &&
    args !== null &&
    (args as { background?: unknown }).background === true;
  if (isBackground || result.isError) {
    return {
      card: "generic",
      content: [
        {
          type: "text",
          text: `\`\`\`console\n${raw.replace(/\n+$/, "")}\n\`\`\``,
        },
      ],
    };
  }
  const { body, ...exit } = parseExitStatus(raw);
  return { card: "terminal", output: body, ...exit };
}
