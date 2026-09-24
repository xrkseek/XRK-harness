/**
 * HTTP browser session: one active page, snapshot refs, act (click/type).
 * Reuses WebFetch + URL policy — not CDP/Playwright (desktop computer-use is separate).
 */
import { htmlToText } from "./html-text.js";
import {
  extractBrowserElements,
  formatBrowserSnapshot,
  titleFromHtml,
  type BrowserElement,
} from "./browser-html.js";
import type { WebFetch } from "./types.js";
import { WebError } from "./types.js";

export interface BrowserSnapshotResult {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

export interface BrowserActRequest {
  readonly ref: string;
  readonly action: "click" | "type";
  readonly text?: string;
}

export interface BrowserActResult {
  readonly url: string;
  readonly title: string;
  readonly note: string;
  readonly text: string;
}

export interface BrowserSession {
  open(url: string, signal?: AbortSignal): Promise<BrowserSnapshotResult>;
  snapshot(opts?: {
    readonly full?: boolean;
  }): Promise<BrowserSnapshotResult>;
  /**
   * Graphical screenshot for vision. HTTP sessions have no browser and must
   * throw instead of returning the element list.
   */
  captureScreenshot(signal?: AbortSignal): Promise<Uint8Array>;
  act(
    request: BrowserActRequest,
    signal?: AbortSignal,
  ): Promise<BrowserActResult>;
  /** Optional teardown (CDP WS / clear page). Registry calls this on drop. */
  dispose?(): void;
}

interface PageState {
  url: string;
  title: string;
  html: string;
  elements: BrowserElement[];
  fieldValues: Map<string, string>;
}

function resolveHref(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    throw new WebError(`invalid href: ${href}`, "WEB_INVALID_URL");
  }
}

export function createHttpBrowserSession(options: {
  readonly fetch: WebFetch;
}): BrowserSession {
  let page: PageState | undefined;

  const load = async (
    url: string,
    signal?: AbortSignal,
  ): Promise<PageState> => {
    const result = await options.fetch.fetch({ url }, signal);
    const html =
      result.body.kind === "html"
        ? result.body.content
        : result.body.content;
    const elements = extractBrowserElements(html);
    return {
      url: result.url,
      title: titleFromHtml(html),
      html,
      elements,
      fieldValues: new Map(),
    };
  };

  const requirePage = (): PageState => {
    if (!page) {
      throw new WebError(
        "no open page — call browser_open first",
        "WEB_BROWSER_NO_PAGE",
      );
    }
    return page;
  };

  const snapshotOf = (
    state: PageState,
    full?: boolean,
  ): BrowserSnapshotResult => {
    const pageText = full
      ? htmlToText(state.html, 40_000).text
      : undefined;
    return {
      url: state.url,
      title: state.title,
      text: formatBrowserSnapshot({
        url: state.url,
        title: state.title,
        elements: state.elements,
        fieldValues: state.fieldValues,
        ...(full ? { full: true } : {}),
        ...(pageText !== undefined ? { pageText } : {}),
      }),
    };
  };

  return {
    async open(url, signal) {
      page = await load(url, signal);
      return snapshotOf(page, false);
    },
    async snapshot(opts) {
      return snapshotOf(requirePage(), opts?.full === true);
    },
    async captureScreenshot() {
      throw new WebError(
        "no graphical browser — HTTP snapshot cannot capture a screenshot for vision. Set XRK_BROWSER_CDP_URL.",
        "WEB_BROWSER_NO_GRAPHICS",
      );
    },
    async act(request, signal) {
      const state = requirePage();
      const ref = request.ref.replace(/^@/, "").trim();
      const el = state.elements.find((e) => e.ref === ref);
      if (!el) {
        throw new WebError(`unknown ref @${ref}`, "WEB_BROWSER_BAD_REF");
      }
      if (request.action === "type") {
        if (el.role !== "textbox" && el.role !== "combobox") {
          throw new WebError(
            `@${ref} is not a textbox`,
            "WEB_BROWSER_BAD_REF",
          );
        }
        const text = request.text ?? "";
        state.fieldValues.set(el.ref, text);
        const snap = snapshotOf(state, false);
        return {
          ...snap,
          note: `typed into @${ref}`,
        };
      }
      // click
      if (el.href) {
        const next = resolveHref(state.url, el.href);
        page = await load(next, signal);
        const snap = snapshotOf(page, false);
        return { ...snap, note: `navigated via @${ref}` };
      }
      if (
        el.role === "button" &&
        (el.inputType === "submit" || /submit/i.test(el.name))
      ) {
        // Best-effort GET to current URL with typed fields as query.
        const target = new URL(state.url);
        for (const [r, value] of state.fieldValues) {
          const field = state.elements.find((e) => e.ref === r);
          const key = field?.name || r;
          target.searchParams.set(key, value);
        }
        page = await load(target.href, signal);
        const snap = snapshotOf(page, false);
        return { ...snap, note: `submitted via @${ref}` };
      }
      const snap = snapshotOf(state, false);
      return {
        ...snap,
        note: `clicked @${ref} (no navigation — static HTTP session)`,
      };
    },
    dispose() {
      page = undefined;
    },
  };
}
