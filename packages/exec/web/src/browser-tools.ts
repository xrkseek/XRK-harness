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
  /**
   * Live route image intake. When false, `browser_vision` soft-degrades
   * (gallery keeps PNG; text notes pixels are off-wire).
   */
  readonly routeAllowsImage?: () => boolean;
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
 * One-shot URL reads belong on web_fetch / web_search — that routing lives in
 * web family guidance, not in these tool descriptions.
 */
export function createBrowserTools(
  session: BrowserSession,
  options: BrowserToolsOptions = {},
): ToolDefinition[] {
  const openTool: ToolDefinition<{ url: string }> = {
    name: "browser_open",
    description:
      "Open an HTTP(S) URL in the interactive browser session and return a compact element snapshot with @eN refs. " +
      "Backend is agent-browser: system Chrome first, then the product Chromium cache, then Edge.",
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
      "Snapshot the current page as an interactive element list with @eN refs for browser_act. " +
      "Pass full=true to include page text under the list.",
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

  const ACT_ACTIONS = [
    "click",
    "dblclick",
    "type",
    "fill",
    "scroll",
    "scrollintoview",
    "press",
    "check",
    "uncheck",
    "focus",
    "drag",
    "back",
  ] as const;
  const actTool: ToolDefinition<{
    ref?: string;
    ref2?: string;
    action: string;
    text?: string;
    direction?: string;
    key?: string;
    amount?: number;
  }> = {
    name: "browser_act",
    description:
      "Click, type, scroll, and other actions on the open page. " +
      "Element actions need a @eN ref from the latest snapshot (see the action enum).",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description:
            "Element ref from the snapshot (e1 or @e1). Required except scroll/press/back.",
        },
        ref2: {
          type: "string",
          description: "Destination ref when action=drag.",
        },
        action: {
          type: "string",
          description: "agent-browser action.",
          enum: [...ACT_ACTIONS],
        },
        text: {
          type: "string",
          description: "Text for type/fill; optional key fallback for press.",
        },
        direction: {
          type: "string",
          description: "Scroll direction when action=scroll.",
          enum: ["up", "down", "left", "right"],
        },
        key: {
          type: "string",
          description: "Key name when action=press (e.g. Enter, Tab, Escape).",
        },
        amount: {
          type: "number",
          description: "Optional scroll distance in px.",
        },
      },
      required: ["action"],
    },
    async execute(args, signal) {
      const action = String(args?.action ?? "").trim().toLowerCase();
      const allowed = new Set<string>(ACT_ACTIONS);
      if (!allowed.has(action)) {
        return failArgs(`action must be one of ${ACT_ACTIONS.join(", ")}`);
      }
      const needsRef = new Set([
        "click",
        "dblclick",
        "type",
        "fill",
        "check",
        "uncheck",
        "focus",
        "scrollintoview",
        "drag",
      ]);
      if (needsRef.has(action) && !String(args?.ref ?? "").trim()) {
        return failArgs(`ref is required for ${action}`);
      }
      if (action === "drag" && !String(args?.ref2 ?? "").trim()) {
        return failArgs("ref2 is required for drag");
      }
      if (action === "scroll") {
        const direction = String(args?.direction ?? "down").trim().toLowerCase();
        if (!["up", "down", "left", "right"].includes(direction)) {
          return failArgs("direction must be up, down, left, or right");
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
            action: action as (typeof ACT_ACTIONS)[number],
            ...(args?.ref !== undefined ? { ref: String(args.ref) } : {}),
            ...(args?.ref2 !== undefined ? { ref2: String(args.ref2) } : {}),
            ...(args?.text !== undefined ? { text: String(args.text) } : {}),
            ...(args?.direction !== undefined
              ? {
                  direction: String(args.direction).toLowerCase() as
                    | "up"
                    | "down"
                    | "left"
                    | "right",
                }
              : {}),
            ...(args?.key !== undefined ? { key: String(args.key) } : {}),
            ...(typeof args?.amount === "number"
              ? { amount: args.amount }
              : {}),
          },
          signal,
        );
        return {
          content: `${result.note}\n\n${result.text}`,
        };
      } catch (err) {
        const out = fail(err);
        if (
          typeof out.content === "string" &&
          /covered by/i.test(out.content) &&
          !/click the covering/i.test(out.content)
        ) {
          return {
            ...out,
            content:
              `${out.content}\n\nHint: snapshot, click the covering element (or Escape to dismiss), then snapshot again. Do not retry the same covered @ref.`,
          };
        }
        return out;
      }
    },
    isConcurrencySafe: () => false,
  };

  const visionTool: ToolDefinition<{ question?: string }> = {
    name: "browser_vision",
    description:
      "Take a screenshot of the graphical page and return it with the @eN snapshot text. " +
      "Needs a graphical browser. Prefer the accessibility snapshot for ordinary clicking; use this when you need to see pixels.",
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
        const textOnlyRoute =
          options.routeAllowsImage !== undefined && !options.routeAllowsImage();
        const body = textOnlyRoute
          ? [
              lead.trimEnd(),
              text.trimEnd(),
              `attachmentId=${ref.attachmentId}`,
              "note=text-only route: the screenshot did not reach you (pixels off wire)",
              "use=prefer snapshot/find/act; do not guess at pixels; switch model then re-call browser_vision",
            ]
              .filter((line) => line.length > 0)
              .join("\n")
          : `${lead}${text}`.trim();
        return {
          content: [
            { type: "text" as const, text: body },
            { type: "image" as const, attachment: ref },
          ],
          ...(textOnlyRoute ? { meta: { textOnlyRoute: true } } : {}),
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
        "Run JavaScript in the active page. Prefer snapshot and act for normal UI work; use this for DOM reads the accessibility tree misses.",
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
        "Wait for a selector, a load milestone, or a fixed delay in milliseconds.",
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
        "Get, set, or clear cookies in the browser session. Prefer the Settings profile / restore / statePath for logged-in profiles; use this for per-origin tweaks.",
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
        "List, open, switch, or close tabs (ids look like t2). Labels on action=new are slugified to ASCII.",
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
          label: {
            type: "string",
            description: "Optional label when action=new.",
          },
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
    const getTool: ToolDefinition<{
      what?: string;
      selector?: string;
      attrName?: string;
    }> = {
      name: "browser_get",
      description:
        "Read a page or element field (text, HTML, URL, title, value, box, count, styles, or an attribute).",
      parameters: {
        type: "object",
        properties: {
          what: {
            type: "string",
            enum: [
              "text",
              "html",
              "url",
              "title",
              "value",
              "box",
              "count",
              "styles",
              "attr",
            ],
            description: "Which field to read (default text).",
          },
          selector: {
            type: "string",
            description:
              "CSS or @ref selector (default body for element fields). Ignored for url/title.",
          },
          attrName: {
            type: "string",
            description: "Attribute name when what=attr.",
          },
        },
      },
      async execute(args, signal) {
        const whatRaw = String(args?.what ?? "text").trim().toLowerCase();
        const allowed = new Set([
          "text",
          "html",
          "url",
          "title",
          "value",
          "box",
          "count",
          "styles",
          "attr",
        ]);
        const what = allowed.has(whatRaw)
          ? (whatRaw as
              | "text"
              | "html"
              | "url"
              | "title"
              | "value"
              | "box"
              | "count"
              | "styles"
              | "attr")
          : "text";
        const selector =
          args?.selector !== undefined ? String(args.selector).trim() : "";
        const attrName =
          args?.attrName !== undefined ? String(args.attrName).trim() : "";
        if (what === "attr" && !attrName) {
          return failArgs("attrName is required when what=attr");
        }
        try {
          return {
            content: await getFn(
              what,
              signal,
              selector || undefined,
              attrName || undefined,
            ),
          };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => true,
    };
    tools.push(getTool);
  }

  if (typeof session.is === "function") {
    const isFn = session.is.bind(session);
    const isTool: ToolDefinition<{ what?: string; ref: string }> = {
      name: "browser_is",
      description:
        "Check whether an element is visible, enabled, or checked.",
      parameters: {
        type: "object",
        properties: {
          what: {
            type: "string",
            enum: ["visible", "enabled", "checked"],
            description: "State to check (default visible).",
          },
          ref: { type: "string", description: "Element ref (e1 or @e1)." },
        },
        required: ["ref"],
      },
      async execute(args, signal) {
        const ref = String(args?.ref ?? "").trim();
        if (!ref) return failArgs("ref is required");
        const whatRaw = String(args?.what ?? "visible").trim().toLowerCase();
        const what =
          whatRaw === "enabled" || whatRaw === "checked" ? whatRaw : "visible";
        try {
          return { content: await isFn(what, ref, signal) };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => true,
    };
    tools.push(isTool);
  }

  if (typeof session.find === "function") {
    const findFn = session.find.bind(session);
    const findTool: ToolDefinition<{
      locator?: string;
      value?: string;
      name?: string;
      action?: string;
      text?: string;
      exact?: boolean;
      nth?: number;
    }> = {
      name: "browser_find",
      description:
        "Locate an element by semantics and act on it in one step. Prefer it when @eN refs are missing or stale. Default action=click; action=text reads the text instead.",
      parameters: {
        type: "object",
        properties: {
          locator: {
            type: "string",
            enum: [
              "role",
              "text",
              "label",
              "placeholder",
              "alt",
              "title",
              "testid",
              "first",
              "last",
              "nth",
            ],
            description: "Semantic locator kind (default role).",
          },
          value: {
            type: "string",
            description:
              "Locator value (ARIA role, visible text, CSS for first/last/nth, …).",
          },
          name: {
            type: "string",
            description: "Accessible name filter when locator=role.",
          },
          action: {
            type: "string",
            enum: ["click", "fill", "check", "hover", "text"],
            description: "Action after locate (default click).",
          },
          text: {
            type: "string",
            description: "Fill text when action=fill.",
          },
          exact: {
            type: "boolean",
            description: "Exact match for text/name.",
          },
          nth: {
            type: "number",
            description: "0-based index when locator=nth.",
          },
        },
        required: ["value"],
      },
      async execute(args, signal) {
        const value = String(args?.value ?? "").trim();
        if (!value) return failArgs("value is required");
        const locatorRaw = String(args?.locator ?? "role").trim().toLowerCase();
        const locator =
          locatorRaw === "text" ||
          locatorRaw === "label" ||
          locatorRaw === "placeholder" ||
          locatorRaw === "alt" ||
          locatorRaw === "title" ||
          locatorRaw === "testid" ||
          locatorRaw === "first" ||
          locatorRaw === "last" ||
          locatorRaw === "nth"
            ? locatorRaw
            : "role";
        const actionRaw = String(args?.action ?? "click").trim().toLowerCase();
        const action =
          actionRaw === "fill" ||
          actionRaw === "check" ||
          actionRaw === "hover" ||
          actionRaw === "text"
            ? actionRaw
            : "click";
        try {
          const result = await findFn(
            {
              locator,
              value,
              action,
              ...(args?.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args?.text !== undefined
                ? { text: String(args.text) }
                : {}),
              ...(args?.exact === true ? { exact: true } : {}),
              ...(args?.nth !== undefined ? { nth: Number(args.nth) } : {}),
            },
            signal,
          );
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(findTool);
  }

  if (typeof session.frame === "function") {
    const frameFn = session.frame.bind(session);
    const frameTool: ToolDefinition<{ target?: string }> = {
      name: "browser_frame",
      description:
        "Switch into an iframe by CSS selector, or back to the main document. Snapshot again afterwards — refs from the previous frame do not carry over.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              'CSS selector for iframe, or "main" to leave the iframe (default main).',
          },
        },
      },
      async execute(args, signal) {
        const target = String(args?.target ?? "main").trim() || "main";
        try {
          const snap = await frameFn(target, signal);
          return { content: snap.text };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(frameTool);
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

  if (typeof session.upload === "function") {
    const uploadFn = session.upload.bind(session);
    const uploadTool: ToolDefinition<{ ref: string; files: string[] }> = {
      name: "browser_upload",
      description:
        "Upload local file path(s) onto a file-input @ref.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "File input ref (e1 or @e1)." },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Absolute local file paths to upload.",
          },
        },
        required: ["ref", "files"],
      },
      async execute(args, signal) {
        const ref = String(args?.ref ?? "").trim();
        if (!ref) return failArgs("ref is required");
        const files = Array.isArray(args?.files)
          ? args.files.map((f) => String(f))
          : [];
        if (files.length === 0) return failArgs("files must be a non-empty array");
        try {
          const result = await uploadFn(ref, files, signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(uploadTool);
  }

  if (typeof session.download === "function") {
    const downloadFn = session.download.bind(session);
    const downloadTool: ToolDefinition<{ ref: string; destPath: string }> = {
      name: "browser_download",
      description:
        "Click a download trigger @ref and save the file to destPath.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Element ref (e1 or @e1)." },
          destPath: {
            type: "string",
            description: "Absolute path where the download should be saved.",
          },
        },
        required: ["ref", "destPath"],
      },
      async execute(args, signal) {
        const ref = String(args?.ref ?? "").trim();
        const destPath = String(args?.destPath ?? "").trim();
        if (!ref) return failArgs("ref is required");
        if (!destPath) return failArgs("destPath is required");
        try {
          const result = await downloadFn(ref, destPath, signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(downloadTool);
  }

  if (typeof session.keyboardType === "function") {
    const kbFn = session.keyboardType.bind(session);
    const kbTool: ToolDefinition<{ text: string }> = {
      name: "browser_keyboard",
      description:
        "Type with real keystrokes into the focused element. Prefer browser_act type/fill with a ref when you have one.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to type." },
        },
        required: ["text"],
      },
      async execute(args, signal) {
        const text = String(args?.text ?? "");
        try {
          const result = await kbFn(text, signal);
          return { content: `${result.note}\n\n${result.text}` };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(kbTool);
  }

  if (typeof session.pdf === "function") {
    const pdfFn = session.pdf.bind(session);
    const pdfTool: ToolDefinition<{ destPath: string }> = {
      name: "browser_pdf",
      description: "Save the active page as a PDF.",
      parameters: {
        type: "object",
        properties: {
          destPath: {
            type: "string",
            description: "Absolute path for the PDF file.",
          },
        },
        required: ["destPath"],
      },
      async execute(args, signal) {
        const destPath = String(args?.destPath ?? "").trim();
        if (!destPath) return failArgs("destPath is required");
        try {
          return { content: await pdfFn(destPath, signal) };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(pdfTool);
  }

  if (typeof session.consoleLogs === "function") {
    const consoleFn = session.consoleLogs.bind(session);
    const consoleTool: ToolDefinition<{ clear?: boolean }> = {
      name: "browser_console",
      description: "Read page console logs.",
      parameters: {
        type: "object",
        properties: {
          clear: {
            type: "boolean",
            description: "Clear the console buffer after reading.",
          },
        },
      },
      async execute(args, signal) {
        try {
          return {
            content: await consoleFn(args?.clear === true, signal),
          };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => true,
    };
    tools.push(consoleTool);
  }

  if (typeof session.pageErrors === "function") {
    const errFn = session.pageErrors.bind(session);
    const errTool: ToolDefinition<{ clear?: boolean }> = {
      name: "browser_errors",
      description: "Read page JavaScript errors.",
      parameters: {
        type: "object",
        properties: {
          clear: {
            type: "boolean",
            description: "Clear the error buffer after reading.",
          },
        },
      },
      async execute(args, signal) {
        try {
          return { content: await errFn(args?.clear === true, signal) };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => true,
    };
    tools.push(errTool);
  }

  if (typeof session.clipboard === "function") {
    const clipFn = session.clipboard.bind(session);
    const clipTool: ToolDefinition<{ op?: string; text?: string }> = {
      name: "browser_clipboard",
      description:
        "Read, write, copy, or paste the browser clipboard. Prefer browser_act fill for form fields.",
      parameters: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["read", "write", "copy", "paste"],
            description: "Clipboard operation (default read).",
          },
          text: {
            type: "string",
            description: "Text for write/copy.",
          },
        },
      },
      async execute(args, signal) {
        const opRaw = String(args?.op ?? "read").trim().toLowerCase();
        const op =
          opRaw === "write" || opRaw === "copy" || opRaw === "paste"
            ? opRaw
            : "read";
        try {
          return {
            content: await clipFn(
              op,
              args?.text !== undefined ? String(args.text) : undefined,
              signal,
            ),
          };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: () => false,
    };
    tools.push(clipTool);
  }

  if (typeof session.storage === "function") {
    const storageFn = session.storage.bind(session);
    const storageTool: ToolDefinition<{
      kind?: string;
      action?: string;
      key?: string;
      value?: string;
    }> = {
      name: "browser_storage",
      description:
        "Read or write localStorage / sessionStorage on the active page.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["local", "session"],
            description: "Storage kind (default local).",
          },
          action: {
            type: "string",
            enum: ["get", "set", "clear"],
            description: "get (default), set, or clear.",
          },
          key: { type: "string", description: "Storage key (get/set)." },
          value: { type: "string", description: "Value when action=set." },
        },
      },
      async execute(args, signal) {
        const kind =
          String(args?.kind ?? "local").trim().toLowerCase() === "session"
            ? "session"
            : "local";
        const actionRaw = String(args?.action ?? "get").trim().toLowerCase();
        const action =
          actionRaw === "set" || actionRaw === "clear" ? actionRaw : "get";
        try {
          return {
            content: await storageFn(
              kind,
              action,
              args?.key !== undefined ? String(args.key) : undefined,
              args?.value !== undefined ? String(args.value) : undefined,
              signal,
            ),
          };
        } catch (err) {
          return fail(err);
        }
      },
      isConcurrencySafe: (callArgs) => actionIsRead(callArgs?.action),
    };
    tools.push(storageTool);
  }

  return tools;
}

function actionIsRead(action: unknown): boolean {
  const raw = String(action ?? "get").trim().toLowerCase();
  return raw !== "set" && raw !== "clear";
}
