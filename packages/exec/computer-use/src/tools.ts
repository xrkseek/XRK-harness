import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import {
  COMPUTER_USE_PROMPT_TEXT,
  formatActResult,
  formatCaptureEnvelope,
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

/** Enough of an image ref for multimodal capture results (mirrors browser_vision). */
export interface ComputerUseScreenshotRef {
  readonly attachmentId: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
}

export function computerUseUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
  product?: { readonly mode?: string },
): string {
  const envFlag = String(env.XRK_COMPUTER_USE ?? "").trim();
  const productOn =
    product?.mode === "uia" || product?.mode === "background";
  if (process.platform === "win32" && envFlag === "" && !productOn) {
    return (
      "Error: computer_use is off. Enable Settings → Plugins → Computer use " +
      "(or XRK_COMPUTER_USE=1) for Windows UIA."
    );
  }
  return (
    "Error: no computer_use Provider. Enable Settings → Plugins → Computer use " +
    "or inject a ComputerUseService (Windows: XRK_COMPUTER_USE=1)."
  );
}

export interface CreateComputerUseToolsOptions {
  readonly service?: ComputerUseService;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: { readonly mode?: string };
  /** Persist capture PNG so the model request can inline it (mode=vision|som). */
  readonly saveScreenshot?: (
    png: Uint8Array,
  ) => Promise<ComputerUseScreenshotRef>;
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

function parseCoordinate(raw: unknown): readonly [number, number] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new ComputerUseError(
      "coordinate must be [x, y] screen pixels",
      "COMPUTER_USE_BAD_ARGS",
    );
  }
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new ComputerUseError(
      "coordinate must be finite [x, y] numbers",
      "COMPUTER_USE_BAD_ARGS",
    );
  }
  return [Math.trunc(x), Math.trunc(y)];
}

/**
 * Model-facing `computer_use` tool (Codex-style capture → act → re-capture loop).
 * Separate from browser_open / browser_snapshot / browser_act.
 */
export function createComputerUseTools(
  options: CreateComputerUseToolsOptions = {},
): ToolDefinition[] {
  const missing = computerUseUnavailableMessage(
    options.env ?? process.env,
    options.product,
  );

  const tool: ToolDefinition<{
    action?: string;
    mode?: string;
    app?: string;
    element?: number;
    text?: string;
    keys?: string;
    direction?: string;
    amount?: number;
    coordinate?: unknown;
  }> = {
    name: "computer_use",
    description:
      "Native desktop GUI. Loop: list_windows → capture → click/type/key/scroll by element index → capture. " +
      "capture mode=ax|vision|som (vision/som add an inline screenshot). Web pages: browser_*.",
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
          description:
            "capture mode; ax=tree only (default); vision=PNG+AX; som=PNG with index labels+AX.",
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
        coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description:
            "Optional screen pixel [x, y] for action=click when element is omitted (vision/som).",
        },
      },
      required: ["action"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Computer use",
      kind: "execute",
      rawInput: args,
    }),
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
          const png = snap.screenshotPng;
          if (png && png.byteLength > 0) {
            const save = options.saveScreenshot;
            if (!save) {
              return {
                content:
                  "Error: desktop screenshot captured but no attachment store is wired, so vision cannot see it.",
                isError: true,
                error: {
                  name: "ComputerUseError",
                  code: "COMPUTER_USE_BACKEND",
                },
              };
            }
            const ref = await save(png);
            const text = formatCaptureEnvelope({
              snapshotText: snap.text,
              mode: snap.mode,
              attachmentId: ref.attachmentId,
              elementCount: snap.elements.length,
            });
            return {
              content: [
                { type: "text" as const, text },
                { type: "image" as const, attachment: ref },
              ],
              meta: { mode: snap.mode, attachmentId: ref.attachmentId },
            };
          }
          return {
            content: formatCaptureEnvelope({
              snapshotText: snap.text,
              mode: snap.mode,
              elementCount: snap.elements.length,
            }),
            meta: { mode: snap.mode },
          };
        }
        if (action === "list_windows") {
          const windows = await options.service.listWindows(signal);
          return { content: formatWindowsList(windows) };
        }
        const coordinate = parseCoordinate(args?.coordinate);
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
            ...(coordinate !== undefined ? { coordinate } : {}),
          },
          signal,
        );
        return { content: formatActResult(result) };
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
