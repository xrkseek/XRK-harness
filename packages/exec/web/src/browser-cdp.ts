/**
 * Optional Chrome DevTools (CDP) backend for browser_*.
 * HTTP snapshot stays the default. @eN refs are unchanged.
 */
import {
  formatBrowserSnapshot,
  type BrowserElement,
} from "./browser-html.js";
import type {
  BrowserActResult,
  BrowserSession,
  BrowserSnapshotResult,
} from "./browser-session.js";
import { createHttpBrowserSession } from "./browser-session.js";
import type { WebFetch } from "./types.js";
import { WebError } from "./types.js";

const INTERACTIVE = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "tab",
]);

export interface CdpCaller {
  call(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown>;
  close(): void;
}

interface CdpNode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly backendNodeId: number;
}

interface AxNode {
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
  readonly backendDOMNodeId?: unknown;
  readonly ignored?: unknown;
}

export function browserCdpUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.XRK_BROWSER_CDP_URL?.trim() ||
    env.BROWSER_CDP_URL?.trim() ||
    ""
  );
}

/** Hermes-style: pass through a browser websocket, else GET /json/version. */
export async function resolveCdpDebuggerUrl(
  raw: string,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new WebError("empty CDP url", "WEB_BROWSER_CDP");
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.includes("/devtools/browser/") || lowered.includes("/devtools/page/")) {
    return trimmed;
  }
  let discovery = trimmed;
  if (lowered.startsWith("ws://") || lowered.startsWith("wss://")) {
    discovery =
      (lowered.startsWith("wss://") ? "https://" : "http://") +
      trimmed.slice(trimmed.indexOf("://") + 3);
  }
  const versionUrl = discovery.toLowerCase().endsWith("/json/version")
    ? discovery
    : `${discovery.replace(/\/$/, "")}/json/version`;
  const payload = await fetchJson(versionUrl);
  const ws =
    payload && typeof payload === "object"
      ? (payload as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl
      : undefined;
  if (typeof ws === "string" && ws.trim()) return ws.trim();
  throw new WebError(
    `CDP discovery at ${versionUrl} did not return webSocketDebuggerUrl`,
    "WEB_BROWSER_CDP",
  );
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new WebError(
      `CDP discovery HTTP ${response.status}`,
      "WEB_BROWSER_CDP",
    );
  }
  return response.json();
}

export function connectCdpWebSocket(url: string): Promise<CdpCaller> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let next = 1;
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (err: Error) => void }
    >();
    ws.addEventListener("error", () => {
      reject(new WebError("CDP socket failed", "WEB_BROWSER_CDP"));
    });
    ws.addEventListener("message", (event) => {
      let data: { id?: unknown; result?: unknown; error?: { message?: string } };
      try {
        data = JSON.parse(String(event.data)) as typeof data;
      } catch {
        return;
      }
      if (typeof data.id !== "number") return;
      const waiter = pending.get(data.id);
      if (!waiter) return;
      pending.delete(data.id);
      if (data.error) {
        waiter.reject(
          new WebError(data.error.message ?? "CDP error", "WEB_BROWSER_CDP"),
        );
        return;
      }
      waiter.resolve(data.result);
    });
    ws.addEventListener("open", () => {
      resolve({
        call(method, params, sessionId) {
          const id = next++;
          const message: Record<string, unknown> = {
            id,
            method,
            params: params ?? {},
          };
          if (sessionId) message.sessionId = sessionId;
          ws.send(JSON.stringify(message));
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
          });
        },
        close() {
          ws.close();
        },
      });
    });
  });
}

function axNodes(result: unknown): AxNode[] {
  if (!result || typeof result !== "object") return [];
  const nodes = (result as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) ? (nodes as AxNode[]) : [];
}

function toElements(nodes: readonly AxNode[]): CdpNode[] {
  const out: CdpNode[] = [];
  for (const node of nodes) {
    if (node.ignored === true) continue;
    const role = typeof node.role?.value === "string" ? node.role.value : "";
    if (!INTERACTIVE.has(role)) continue;
    const backend = node.backendDOMNodeId;
    if (typeof backend !== "number") continue;
    const name =
      typeof node.name?.value === "string" && node.name.value.trim()
        ? node.name.value.trim()
        : role;
    out.push({
      ref: `e${out.length + 1}`,
      role,
      name: name.slice(0, 120),
      backendNodeId: backend,
    });
    if (out.length >= 200) break;
  }
  return out;
}

function asElements(nodes: readonly CdpNode[]): BrowserElement[] {
  return nodes.map((node) => ({
    ref: node.ref,
    role: node.role === "link" ? "link" : node.role === "button" ? "button" : node.role,
    name: node.name,
    tag: node.role,
    ...(node.role === "textbox" || node.role === "searchbox"
      ? { inputType: "text" }
      : {}),
  }));
}

export function createCdpBrowserSession(options: {
  readonly rawUrl: string;
  readonly resolve?: (raw: string) => Promise<string>;
  readonly connect?: (wsUrl: string) => Promise<CdpCaller>;
}): BrowserSession {
  const resolve = options.resolve ?? resolveCdpDebuggerUrl;
  const connect = options.connect ?? connectCdpWebSocket;
  let caller: CdpCaller | undefined;
  let sessionId: string | undefined;
  let browserLevel = false;
  let nodes: CdpNode[] = [];
  let url = "";
  let title = "";
  const fieldValues = new Map<string, string>();

  const ensure = async (): Promise<CdpCaller> => {
    if (caller) return caller;
    const wsUrl = await resolve(options.rawUrl);
    browserLevel = wsUrl.toLowerCase().includes("/devtools/browser/");
    caller = await connect(wsUrl);
    return caller;
  };

  const pageEval = async (
    cdp: CdpCaller,
    expression: string,
  ): Promise<string> => {
    const result = (await cdp.call(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
    )) as { result?: { value?: unknown } };
    const value = result?.result?.value;
    return typeof value === "string" ? value : "";
  };

  const readMeta = async (cdp: CdpCaller): Promise<void> => {
    url = (await pageEval(cdp, "location.href")) || url;
    title = await pageEval(cdp, "document.title");
  };

  const capture = async (cdp: CdpCaller): Promise<CdpNode[]> => {
    await cdp.call("Accessibility.enable", {}, sessionId);
    const tree = await cdp.call("Accessibility.getFullAXTree", {}, sessionId);
    nodes = toElements(axNodes(tree));
    await readMeta(cdp);
    return nodes;
  };

  const paint = (full?: boolean): BrowserSnapshotResult => ({
    url,
    title,
    text: formatBrowserSnapshot({
      url,
      title,
      elements: asElements(nodes),
      fieldValues,
      ...(full ? { full: true, pageText: "" } : {}),
    }),
  });

  const requireCaller = (): CdpCaller => {
    if (!caller) {
      throw new WebError(
        "no open page — call browser_open first",
        "WEB_BROWSER_NO_PAGE",
      );
    }
    return caller;
  };

  return {
    async open(nextUrl) {
      const cdp = await ensure();
      if (browserLevel) {
        const created = (await cdp.call("Target.createTarget", {
          url: nextUrl,
        })) as { targetId?: string };
        const targetId = created.targetId ?? "";
        const attached = (await cdp.call("Target.attachToTarget", {
          targetId,
          flatten: true,
        })) as { sessionId?: string };
        sessionId = attached.sessionId;
      } else {
        await cdp.call("Page.navigate", { url: nextUrl }, sessionId);
      }
      url = nextUrl;
      fieldValues.clear();
      await capture(cdp);
      return paint(false);
    },
    async snapshot(opts) {
      const cdp = requireCaller();
      await capture(cdp);
      return paint(opts?.full === true);
    },
    async captureScreenshot() {
      const cdp = requireCaller();
      await cdp.call("Page.enable", {}, sessionId);
      const shot = (await cdp.call(
        "Page.captureScreenshot",
        { format: "png" },
        sessionId,
      )) as { data?: unknown };
      const data = typeof shot.data === "string" ? shot.data.trim() : "";
      if (!data) {
        throw new WebError(
          "CDP captureScreenshot returned no image",
          "WEB_BROWSER_CDP",
        );
      }
      return Buffer.from(data, "base64");
    },
    async act(request): Promise<BrowserActResult> {
      const cdp = requireCaller();
      const ref = request.ref.replace(/^@/, "").trim();
      const node = nodes.find((item) => item.ref === ref);
      if (!node) {
        throw new WebError(`unknown ref @${ref}`, "WEB_BROWSER_BAD_REF");
      }
      const resolved = (await cdp.call(
        "DOM.resolveNode",
        { backendNodeId: node.backendNodeId },
        sessionId,
      )) as { object?: { objectId?: string } };
      const objectId = resolved.object?.objectId;
      if (!objectId) {
        throw new WebError(`CDP could not resolve @${ref}`, "WEB_BROWSER_CDP");
      }
      if (request.action === "type") {
        if (node.role !== "textbox" && node.role !== "searchbox" && node.role !== "combobox") {
          throw new WebError(`@${ref} is not a textbox`, "WEB_BROWSER_BAD_REF");
        }
        const text = request.text ?? "";
        fieldValues.set(ref, text);
        await cdp.call(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration:
              "function(value){ this.focus(); this.value = value; this.dispatchEvent(new Event('input', { bubbles: true })); }",
            arguments: [{ value: text }],
          },
          sessionId,
        );
        await capture(cdp);
        return { ...paint(false), note: `typed into @${ref}` };
      }
      await cdp.call(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: "function(){ if (this.click) this.click(); }",
        },
        sessionId,
      );
      await capture(cdp);
      return { ...paint(false), note: `clicked @${ref}` };
    },
  };
}

/** HTTP snapshot unless XRK_BROWSER_CDP_URL / BROWSER_CDP_URL is set. */
export function createBrowserSession(options: {
  readonly fetch: WebFetch;
  readonly env?: NodeJS.ProcessEnv;
  readonly resolve?: (raw: string) => Promise<string>;
  readonly connect?: (wsUrl: string) => Promise<CdpCaller>;
}): BrowserSession {
  const raw = browserCdpUrlFromEnv(options.env ?? process.env);
  if (!raw) {
    return createHttpBrowserSession({ fetch: options.fetch });
  }
  return createCdpBrowserSession({
    rawUrl: raw,
    ...(options.resolve ? { resolve: options.resolve } : {}),
    ...(options.connect ? { connect: options.connect } : {}),
  });
}
