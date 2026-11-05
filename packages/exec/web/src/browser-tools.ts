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
  VAULT_UNKNOWN: "WEB_BROWSER_VAULT_UNKNOWN",
  VAULT_EMPTY: "WEB_BROWSER_VAULT_EMPTY",
  VAULT_ORIGIN: "WEB_BROWSER_VAULT_ORIGIN",
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
      "Open an HTTP(S) URL in the interactive browser session and return a compact element snapshot with @eN / [ref=eN] refs. " +
      "Default backend is agent-browser: Auto uses system Chrome, then product Chromium cache, then Edge. Prefer web_fetch for one-shot reads.",
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
      "full=true includes page text.",
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
    ref?: string;
    action: string;
    text?: string;
    direction?: string;
    key?: string;
  }> = {
    name: "browser_act",
    description:
      "Act on the browser session. click/type need a snapshot ref (@eN). " +
      "scroll/press need CDP; back also works on the HTTP history stack.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element ref from the snapshot (e1 or @e1). Required for click/type.",
        },
        action: {
          type: "string",
          description: "click, type, scroll, press, or back.",
          enum: ["click", "type", "scroll", "press", "back"],
        },
        text: {
          type: "string",
          description: "Text to type when action=type (also accepted as key for press).",
        },
        direction: {
          type: "string",
          description: "Scroll direction when action=scroll.",
          enum: ["up", "down"],
        },
        key: {
          type: "string",
          description: "Key name when action=press (e.g. Enter, Tab, Escape).",
        },
      },
      required: ["action"],
    },
    async execute(args, signal) {
      const action = String(args?.action ?? "").trim().toLowerCase();
      const allowed = new Set(["click", "type", "scroll", "press", "back"]);
      if (!allowed.has(action)) {
        return failArgs("action must be click, type, scroll, press, or back");
      }
      if (action === "click" || action === "type") {
        const ref = String(args?.ref ?? "").trim();
        if (!ref) {
          return failArgs("ref is required for click/type");
        }
      }
      if (action === "scroll") {
        const direction = String(args?.direction ?? "down").trim().toLowerCase();
        if (direction !== "up" && direction !== "down") {
          return failArgs("direction must be up or down");
        }
      }
      if (action === "press") {
        const key = String(args?.key ?? args?.text ?? "").trim();
        if (!key) {
          return failArgs("key is required for press (e.g. Enter)");
        }
      }
      try {
        const result = await session.act(
          {
            action: action as "click" | "type" | "scroll" | "press" | "back",
            ...(args?.ref !== undefined ? { ref: String(args.ref) } : {}),
            ...(args?.text !== undefined ? { text: String(args.text) } : {}),
            ...(args?.direction !== undefined
              ? { direction: String(args.direction).toLowerCase() as "up" | "down" }
              : {}),
            ...(args?.key !== undefined ? { key: String(args.key) } : {}),
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
      "Returns the @eN snapshot text plus an image. " +
      "Fails without a graphical browser (HTTP snapshot); does not substitute the accessibility tree.",
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

  const tools: ToolDefinition[] = [
    openTool,
    snapshotTool,
    actTool,
    visionTool,
  ];

  // agent-browser (and future graphical backends) expose richer ops than the
  // Playwright MCP core subset. HTTP sessions omit these methods so we skip
  // registering tools the backend cannot honour.
  if (typeof session.eval === "function") {
    const evalFn = session.eval.bind(session);
    const evalTool: ToolDefinition<{ expression: string }> = {
      name: "browser_eval",
      description:
        "Run JavaScript in the active page (agent-browser eval). Prefer snapshot/act for normal UI; use for DOM reads the accessibility tree misses.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "JavaScript expression to evaluate in the page.",
          },
        },
        required: ["expression"],
      },
      async execute(args, signal) {
        const expression = String(args?.expression ?? "").trim();
        if (!expression) return failArgs("expression must be non-empty");
        try {
          return { content: await evalFn(expression, signal) };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(evalTool);
  }

  if (typeof session.waitFor === "function") {
    const waitFn = session.waitFor.bind(session);
    const waitTool: ToolDefinition<{
      selector?: string;
      ms?: number;
      load?: string;
    }> = {
      name: "browser_wait",
      description:
        "Wait for a selector, a load milestone (load / domcontentloaded / networkidle), or a fixed delay in ms.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS or @ref selector." },
          ms: { type: "number", description: "Fixed delay in milliseconds." },
          load: {
            type: "string",
            description: "load | domcontentloaded | networkidle",
          },
        },
      },
      async execute(args, signal) {
        try {
          await waitFn(
            {
              ...(args?.selector !== undefined
                ? { selector: String(args.selector) }
                : {}),
              ...(typeof args?.ms === "number" ? { ms: args.ms } : {}),
              ...(args?.load !== undefined ? { load: String(args.load) } : {}),
            },
            signal,
          );
          return { content: "waited" };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(waitTool);
  }

  if (typeof session.cookies === "function") {
    const cookiesFn = session.cookies.bind(session);
    const cookiesTool: ToolDefinition<{
      action?: string;
      name?: string;
      value?: string;
      url?: string;
      domain?: string;
      path?: string;
    }> = {
      name: "browser_cookies",
      description:
        "Get, set, or clear cookies in the agent-browser session. Prefer Settings profile / restore / statePath for system login reuse; use this for per-origin tweaks.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["get", "set", "clear"],
            description: "get (default), set, or clear.",
          },
          name: { type: "string", description: "Cookie name (set)." },
          value: { type: "string", description: "Cookie value (set)." },
          url: { type: "string", description: "Cookie URL scope (set)." },
          domain: { type: "string", description: "Cookie domain (set)." },
          path: { type: "string", description: "Cookie path (set)." },
        },
      },
      async execute(args, signal) {
        const actionRaw = String(args?.action ?? "get").trim().toLowerCase();
        const action =
          actionRaw === "set" || actionRaw === "clear" ? actionRaw : "get";
        try {
          const text = await cookiesFn(
            {
              action,
              ...(args?.name !== undefined ? { name: String(args.name) } : {}),
              ...(args?.value !== undefined ? { value: String(args.value) } : {}),
              ...(args?.url !== undefined ? { url: String(args.url) } : {}),
              ...(args?.domain !== undefined
                ? { domain: String(args.domain) }
                : {}),
              ...(args?.path !== undefined ? { path: String(args.path) } : {}),
            },
            signal,
          );
          return { content: text };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(cookiesTool);
  }

  if (typeof session.tabs === "function") {
    const tabsFn = session.tabs.bind(session);
    const tabsTool: ToolDefinition<{
      action?: string;
      target?: string;
      url?: string;
      label?: string;
    }> = {
      name: "browser_tabs",
      description:
        "List, open, switch, or close tabs in the graphical browser session (tab ids like t2 or labels).",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "new", "switch", "close"],
            description: "list (default), new, switch, or close.",
          },
          target: {
            type: "string",
            description: "Tab id (t2) or label for switch/close.",
          },
          url: { type: "string", description: "URL when action=new." },
          label: { type: "string", description: "Optional label when action=new." },
        },
      },
      async execute(args, signal) {
        const actionRaw = String(args?.action ?? "list").trim().toLowerCase();
        const action =
          actionRaw === "new" ||
          actionRaw === "switch" ||
          actionRaw === "close"
            ? actionRaw
            : "list";
        try {
          const text = await tabsFn(
            {
              action,
              ...(args?.target !== undefined
                ? { target: String(args.target) }
                : {}),
              ...(args?.url !== undefined ? { url: String(args.url) } : {}),
              ...(args?.label !== undefined
                ? { label: String(args.label) }
                : {}),
            },
            signal,
          );
          return { content: text };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(tabsTool);
  }

  if (typeof session.getInfo === "function") {
    const getFn = session.getInfo.bind(session);
    const getTool: ToolDefinition<{ what?: string }> = {
      name: "browser_get",
      description:
        "Read text, html, url, or title from the active page (agent-browser get).",
      parameters: {
        type: "object",
        properties: {
          what: {
            type: "string",
            enum: ["text", "html", "url", "title"],
            description: "Which field to read (default text).",
          },
        },
      },
      async execute(args, signal) {
        const whatRaw = String(args?.what ?? "text").trim().toLowerCase();
        const what =
          whatRaw === "html" || whatRaw === "url" || whatRaw === "title"
            ? whatRaw
            : "text";
        try {
          return { content: await getFn(what, signal) };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => true,
    };
    tools.push(getTool);
  }

  if (typeof session.hover === "function") {
    const hoverFn = session.hover.bind(session);
    const hoverTool: ToolDefinition<{ ref: string }> = {
      name: "browser_hover",
      description: "Hover a snapshot @eN ref in the graphical browser.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref (e1 or @e1)." },
        },
        required: ["ref"],
      },
      async execute(args, signal) {
        const ref = String(args?.ref ?? "").trim();
        if (!ref) return failArgs("ref is required");
        try {
          const result = await hoverFn(ref, signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(hoverTool);
  }

  if (typeof session.selectOption === "function") {
    const selectFn = session.selectOption.bind(session);
    const selectTool: ToolDefinition<{
      ref: string;
      values: string[];
    }> = {
      name: "browser_select",
      description: "Select dropdown option(s) by value or visible label on a @eN ref.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref (e1 or @e1)." },
          values: {
            type: "array",
            items: { type: "string" },
            description: "One or more option values / labels.",
          },
        },
        required: ["ref", "values"],
      },
      async execute(args, signal) {
        const ref = String(args?.ref ?? "").trim();
        if (!ref) return failArgs("ref is required");
        const values = Array.isArray(args?.values)
          ? args.values.map((v) => String(v))
          : [];
        if (values.length === 0) return failArgs("values must be a non-empty array");
        try {
          const result = await selectFn(ref, values, signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(selectTool);
  }

  if (typeof session.forward === "function") {
    const forwardFn = session.forward.bind(session);
    const forwardTool: ToolDefinition<Record<string, never>> = {
      name: "browser_forward",
      description: "Navigate forward in the graphical browser history.",
      parameters: { type: "object", properties: {} },
      async execute(_args, signal) {
        try {
          const result = await forwardFn(signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(forwardTool);
  }

  if (typeof session.reload === "function") {
    const reloadFn = session.reload.bind(session);
    const reloadTool: ToolDefinition<Record<string, never>> = {
      name: "browser_reload",
      description: "Reload the active page in the graphical browser.",
      parameters: { type: "object", properties: {} },
      async execute(_args, signal) {
        try {
          const result = await reloadFn(signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(reloadTool);
  }

  return tools;
}
