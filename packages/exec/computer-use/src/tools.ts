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
    product?.mode === "uia" ||
    product?.mode === "background" ||
    product?.mode === "agent-desktop";
  if (envFlag === "" && !productOn) {
    return (
      "Error: computer_use is off (tool not mounted). Enable Settings → Plugins → Computer use " +
      "(agent-desktop / UIA / Background) or set XRK_COMPUTER_USE."
    );
  }
  return (
    "Error: no computer_use Provider. Enable Settings → Plugins → Computer use " +
    "(agent-desktop recommended) or inject a ComputerUseService " +
    "(Windows UIA: XRK_COMPUTER_USE=1)."
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
  /**
   * Live route image intake (same gate as `read_image`). When false, vision/som
   * still attach a gallery image but the text envelope notes pixels are off-wire.
   */
  readonly routeAllowsImage?: () => boolean;
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
    headed?: boolean;
    role?: string;
    name?: string;
    exact?: boolean;
    first?: boolean;
    limit?: number;
  }> = {
    name: "computer_use",
    description:
      "Native desktop GUI (not browser pages). AX capture is headless. " +
      "capture and find return fresh element indices; any newer capture or find invalidates them. " +
      "Real mouse input (coordinate clicks) needs headed=true.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...COMPUTER_USE_ACTIONS],
          description:
            "capture | find | click | type | key | scroll | list_windows | clipboard_set | clipboard_get. find reads role/name/text/exact/first/limit.",
        },
        mode: {
          type: "string",
          enum: ["ax", "som", "vision"],
          description:
            "ax returns the tree only (default); vision and som add a PNG (som labels it with element indices).",
        },
        app: {
          type: "string",
          description: "Optional app/window name filter for capture/find.",
        },
        element: {
          type: "number",
          description: "1-based element index from the last capture/find.",
        },
        text: {
          type: "string",
          description:
            "Text for action=type or clipboard_set; for find, match name/value/description.",
        },
        role: {
          type: "string",
          description: "Accessibility role to match (button, textfield, …).",
        },
        name: {
          type: "string",
          description: "Accessible name or label to match.",
        },
        exact: {
          type: "boolean",
          description: "Exact match on name/text (default substring).",
        },
        first: {
          type: "boolean",
          description: "Return only the first match.",
        },
        limit: {
          type: "number",
          description: "Max matches to return.",
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
            "Screen pixel [x, y] for a click without an element index. Needs headed=true (moves the real mouse).",
        },
        headed: {
          type: "boolean",
          description:
            "Allow real mouse input (--headed). Steals the cursor; set true only when the user accepts that.",
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
          const multimodal =
            options.routeAllowsImage === undefined
              ? undefined
              : options.routeAllowsImage();
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
              ...(multimodal !== undefined ? { multimodal } : {}),
            });
            return {
              content: [
                { type: "text" as const, text },
                { type: "image" as const, attachment: ref },
              ],
              meta: {
                mode: snap.mode,
                attachmentId: ref.attachmentId,
                ...(multimodal === false ? { textOnlyRoute: true } : {}),
              },
            };
          }
          return {
            content: formatCaptureEnvelope({
              snapshotText: snap.text,
              mode: snap.mode,
              elementCount: snap.elements.length,
              ...(multimodal !== undefined ? { multimodal } : {}),
            }),
            meta: {
              mode: snap.mode,
              ...(multimodal === false ? { textOnlyRoute: true } : {}),
            },
          };
        }
        if (action === "list_windows") {
          const windows = await options.service.listWindows(signal);
          return { content: formatWindowsList(windows) };
        }
        if (action === "find") {
          const findFn = options.service.find?.bind(options.service);
          if (findFn === undefined) {
            throw new ComputerUseError(
              "find is not supported by this computer_use Provider",
              "COMPUTER_USE_UNAVAILABLE",
            );
          }
          const multimodal =
            options.routeAllowsImage === undefined
              ? undefined
              : options.routeAllowsImage();
          const snap = await findFn(
            {
              ...(args?.role !== undefined ? { role: String(args.role) } : {}),
              ...(args?.name !== undefined ? { name: String(args.name) } : {}),
              ...(args?.text !== undefined ? { text: String(args.text) } : {}),
              ...(args?.app !== undefined ? { app: String(args.app) } : {}),
              ...(args?.exact === true ? { exact: true } : {}),
              ...(args?.first === true ? { first: true } : {}),
              ...(args?.limit !== undefined
                ? { limit: Number(args.limit) }
                : {}),
            },
            signal,
          );
          return {
            content: formatCaptureEnvelope({
              snapshotText: snap.text,
              mode: snap.mode,
              elementCount: snap.elements.length,
              ...(multimodal !== undefined ? { multimodal } : {}),
            }),
            meta: { mode: snap.mode, action: "find" },
          };
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
            ...(args?.headed === true ? { headed: true } : {}),
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
      return (
        action === "capture" ||
        action === "list_windows" ||
        action === "find"
      );
    },
  };
  return [tool];
}
