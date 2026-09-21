import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import {
  COMPUTER_USE_PROMPT_TEXT,
  formatWindowsList,
} from "./format.js";
import {
  COMPUTER_USE_ACTIONS,
  ComputerUseError,
  isComputerUseError,
  type ComputerUseAction,
  type ComputerUseService,
} from "./types.js";

export { COMPUTER_USE_PROMPT_TEXT };

export function computerUseUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (process.platform === "win32") {
    if (String(env.XRK_COMPUTER_USE ?? "").trim() !== "1") {
      return (
        "Error: desktop computer-use is not enabled. Set XRK_COMPUTER_USE=1 to use the Windows UI Automation Provider " +
        "(accessibility tree + click/type). Separate from browser_* page tools. " +
        "Delivery is UIA, not full background SPI (cua-driver)."
      );
    }
  }
  return (
    "Error: no computer-use Provider is configured. Inject a ComputerUseService " +
    "(or set XRK_COMPUTER_USE=1 on Windows). Prefer browser_* for web pages."
  );
}

export interface CreateComputerUseToolsOptions {
  readonly service?: ComputerUseService;
  readonly env?: NodeJS.ProcessEnv;
}

function fail(err: unknown): ToolResultContent {
  const message = isComputerUseError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

function parseAction(raw: unknown): ComputerUseAction {
  const action = String(raw ?? "").trim() as ComputerUseAction;
  if (!(COMPUTER_USE_ACTIONS as readonly string[]).includes(action)) {
    throw new ComputerUseError(
      `action must be one of ${COMPUTER_USE_ACTIONS.join(", ")}`,
      "COMPUTER_USE_BAD_ARGS",
    );
  }
  return action;
}

/**
 * Model-facing `computer_use` tool (Hermes-style action discriminator).
 * Separate from browser_open / browser_snapshot / browser_act.
 */
export function createComputerUseTools(
  options: CreateComputerUseToolsOptions = {},
): ToolDefinition[] {
  const missing = computerUseUnavailableMessage(options.env ?? process.env);

  const tool: ToolDefinition<{
    action?: string;
    mode?: string;
    app?: string;
    element?: number;
    text?: string;
    keys?: string;
    direction?: string;
    amount?: number;
  }> = {
    name: "computer_use",
    description:
      "Operate the host desktop via an accessibility tree + input Provider. " +
      "Actions: capture (AX snapshot with element indices), click, type, key, scroll, list_windows. " +
      "Prefer capture then click/type by element index. " +
      "Not for web pages — use browser_open / browser_snapshot / browser_act instead.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...COMPUTER_USE_ACTIONS],
          description:
            "capture | click | type | key | scroll | list_windows",
        },
        mode: {
          type: "string",
          enum: ["ax", "som", "vision"],
          description: "capture mode; ax is the default (tree only).",
        },
        app: {
          type: "string",
          description: "Optional app/window name filter for capture.",
        },
        element: {
          type: "number",
          description: "1-based element index from the last capture.",
        },
        text: {
          type: "string",
          description: "Text for action=type.",
        },
        keys: {
          type: "string",
          description: "Key combo for action=key (e.g. ctrl+s, return).",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction.",
        },
        amount: {
          type: "number",
          description: "Scroll wheel ticks (default 3).",
        },
      },
      required: ["action"],
    },
    async execute(args, signal) {
      if (!options.service) {
        return { content: missing, isError: true };
      }
      try {
        const action = parseAction(args?.action);
        if (action === "capture") {
          const snap = await options.service.capture(
            {
              ...(args?.mode !== undefined
                ? { mode: String(args.mode) as "ax" | "som" | "vision" }
                : {}),
              ...(args?.app !== undefined
                ? { app: String(args.app) }
                : {}),
            },
            signal,
          );
          return { content: snap.text };
        }
        if (action === "list_windows") {
          const windows = await options.service.listWindows(signal);
          return { content: formatWindowsList(windows) };
        }
        const result = await options.service.act(
          {
            action,
            ...(args?.element !== undefined
              ? { element: Number(args.element) }
              : {}),
            ...(args?.text !== undefined ? { text: String(args.text) } : {}),
            ...(args?.keys !== undefined ? { keys: String(args.keys) } : {}),
            ...(args?.direction !== undefined
              ? {
                  direction: String(args.direction) as
                    | "up"
                    | "down"
                    | "left"
                    | "right",
                }
              : {}),
            ...(args?.amount !== undefined
              ? { amount: Number(args.amount) }
              : {}),
          },
          signal,
        );
        return {
          content: `${result.message} (delivery=${result.delivery})`,
        };
      } catch (err) {
        return fail(err);
      }
    },
    isConcurrencySafe: (args) => {
      const action = String(args?.action ?? "");
      return action === "capture" || action === "list_windows";
    },
  };

  return [tool];
}
