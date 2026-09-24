import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import type { BrowserSession } from "./browser-session.js";
import { WebError, isWebError } from "./types.js";

/** Enough of an image ref for the vision tool result. Store fills the rest. */
export interface BrowserScreenshotRef {
  readonly attachmentId: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly name?: string;
}

export interface BrowserToolsOptions {
  /** Persist a CDP screenshot so the model request can inline it. */
  readonly saveScreenshot?: (
    png: Uint8Array,
  ) => Promise<BrowserScreenshotRef>;
}

/** Stable machine-readable failure classes for browser_* tool results. */
export const BROWSER_ERROR = {
  NO_PAGE: "WEB_BROWSER_NO_PAGE",
  NO_GRAPHICS: "WEB_BROWSER_NO_GRAPHICS",
  NO_ATTACHMENTS: "WEB_BROWSER_NO_ATTACHMENTS",
  BAD_REF: "WEB_BROWSER_BAD_REF",
  CDP: "WEB_BROWSER_CDP",
  INVALID_ARGS: "WEB_BROWSER_INVALID_ARGS",
} as const;

function fail(err: unknown): ToolResultContent {
  if (isWebError(err)) {
    return {
      content: `Error: ${err.message}`,
      isError: true,
      error: { name: "WebError", code: err.code },
    };
  }
  const message =
    err instanceof Error ? err.message : String(err);
  return {
    content: `Error: ${message}`,
    isError: true,
    error: { name: "WebError", code: BROWSER_ERROR.CDP },
  };
}

function failArgs(message: string): ToolResultContent {
  return {
    content: `Error: ${message}`,
    isError: true,
    error: { name: "WebError", code: BROWSER_ERROR.INVALID_ARGS },
  };
}

/**
 * Interactive browser_* tools over a {@link BrowserSession} (snapshot / act).
 * Prefer web_fetch / web_search for one-shot reads; use these when the model
 * must click or type against a live page session.
 */
export function createBrowserTools(
  session: BrowserSession,
  options: BrowserToolsOptions = {},
): ToolDefinition[] {
  const openTool: ToolDefinition<{ url: string }> = {
    name: "browser_open",
    description:
      "Open an HTTP(S) URL in the interactive browser session and return a compact element snapshot with @eN refs. " +
      "Prefer web_fetch for one-shot reads; use browser_* when you need to click or type.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The HTTP(S) URL to open." },
      },
      required: ["url"],
    },
    async execute(args, signal) {
      const url = String(args?.url ?? "").trim();
      if (!url) {
        return failArgs("url must be a non-empty string");
      }
      try {
        const snap = await session.open(url, signal);
        return { content: snap.text };
      } catch (err) {
        return fail(err);
      }
    },
    isConcurrencySafe: () => false,
  };

  const snapshotTool: ToolDefinition<{ full?: boolean }> = {
    name: "browser_snapshot",
    description:
      "Snapshot the current browser page as an interactive element list with @eN refs for browser_act. " +
      "full=true includes page text. Call browser_open first.",
    parameters: {
      type: "object",
      properties: {
        full: {
          type: "boolean",
          description: "Include page text below the element list.",
        },
      },
    },
    async execute(args) {
      try {
        const snap = await session.snapshot({
          full: args?.full === true,
        });
        return { content: snap.text };
      } catch (err) {
        return fail(err);
      }
    },
    isConcurrencySafe: () => true,
  };

  const actTool: ToolDefinition<{
    ref: string;
    action: string;
    text?: string;
  }> = {
    name: "browser_act",
    description:
      "Act on a snapshot ref: action=click (follow links / submit) or action=type (fill a textbox; pass text). " +
      "Refs look like e1 or @e1 from browser_snapshot / browser_open.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element ref from the snapshot (e1 or @e1).",
        },
        action: {
          type: "string",
          description: "click or type.",
          enum: ["click", "type"],
        },
        text: {
          type: "string",
          description: "Text to type when action=type.",
        },
      },
      required: ["ref", "action"],
    },
    async execute(args, signal) {
      const ref = String(args?.ref ?? "").trim();
      const action = String(args?.action ?? "").trim().toLowerCase();
      if (!ref) {
        return failArgs("ref is required");
      }
      if (action !== "click" && action !== "type") {
        return failArgs("action must be click or type");
      }
      try {
        const result = await session.act(
          {
            ref,
            action,
            ...(args?.text !== undefined ? { text: String(args.text) } : {}),
          },
          signal,
        );
        return {
          content: `${result.note}\n\n${result.text}`,
        };
      } catch (err) {
        return fail(err);
      }
    },
    isConcurrencySafe: () => false,
  };

  const visionTool: ToolDefinition<{ question?: string }> = {
    name: "browser_vision",
    description:
      "Capture a screenshot of the current graphical browser page for vision. " +
      "Returns the @eN snapshot text plus an image. Fails when there is no graphical browser " +
      "(HTTP snapshot) or the screenshot cannot be stored. Does not substitute the accessibility tree.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "What to look for in the screenshot.",
        },
      },
    },
    async execute(args) {
      let png: Uint8Array;
      try {
        png = await session.captureScreenshot();
      } catch (err) {
        return fail(err);
      }
      const save = options.saveScreenshot;
      if (!save) {
        return fail(
          new WebError(
            "screenshot captured but no attachment store is wired, so vision cannot see it.",
            BROWSER_ERROR.NO_ATTACHMENTS,
          ),
        );
      }
      try {
        const ref = await save(png);
        let text = "";
        try {
          text = (await session.snapshot({ full: false })).text;
        } catch {
          text = "";
        }
        const question = String(args?.question ?? "").trim();
        const lead = question ? `question: ${question}\n` : "";
        return {
          content: [
            { type: "text" as const, text: `${lead}${text}`.trim() },
            { type: "image" as const, attachment: ref },
          ],
        };
      } catch (err) {
        return fail(err);
      }
    },
    isConcurrencySafe: () => false,
  };

  return [openTool, snapshotTool, actTool, visionTool];
}
