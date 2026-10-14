/**
 * Anonymous selection translation (DSH translator protocol — no API key).
 * Default Bing Edge; optional Google gtx form. No automatic provider fallback.
 * Used by the product-wide right-click menu.
 */

const BING_ENDPOINT =
  "https://edge.microsoft.com/translate/translatetext";
const GOOGLE_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single";

const MAX_CHARS = 4000;
const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 10_000;

export type SelectionTranslateProvider = "bing" | "google";
export type SelectionTranslateTarget = "zh-Hans" | "zh-Hant" | "en";

export interface SelectionTranslateResult {
  readonly ok: true;
  readonly text: string;
  readonly target: SelectionTranslateTarget;
  readonly provider: SelectionTranslateProvider;
}

export interface SelectionTranslateError {
  readonly ok: false;
  readonly error: string;
}

function pickTarget(source: string): SelectionTranslateTarget {
  // Heuristic: mostly CJK → translate to English; otherwise → Simplified Chinese.
  const cjk = (source.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk >= Math.max(1, source.length * 0.2) ? "en" : "zh-Hans";
}

/** DSH-aligned Chinese tag normalization per provider. */
function languageFor(
  tag: string,
  provider: SelectionTranslateProvider,
): string {
  const lower = tag.toLowerCase();
  if (["zh", "zh-cn", "zh-sg", "zh-hans"].includes(lower)) {
    return provider === "google" ? "zh-CN" : "zh-Hans";
  }
  if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(lower)) {
    return provider === "google" ? "zh-TW" : "zh-Hant";
  }
  return tag;
}

function parseBingBody(payload: unknown): string {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("invalid translation response");
  }
  const first = payload[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("translations" in first) ||
    !Array.isArray((first as { translations: unknown }).translations)
  ) {
    throw new Error("invalid translation response");
  }
  const translated = (first as { translations: unknown[] }).translations[0];
  if (
    typeof translated !== "object" ||
    translated === null ||
    !("text" in translated) ||
    typeof (translated as { text: unknown }).text !== "string"
  ) {
    throw new Error("invalid translation response");
  }
  return (translated as { text: string }).text;
}

function parseGoogleBody(payload: unknown): string {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("invalid translation response");
  }
  const segments = payload[0];
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("invalid translation response");
  }
  return segments
    .map((segment) => {
      if (!Array.isArray(segment)) throw new Error("invalid translation response");
      const text = segment[0];
      if (typeof text !== "string") throw new Error("invalid translation response");
      return text;
    })
    .join("");
}

async function readJsonBounded(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (response.body === null) throw new Error("invalid translation response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`translation response exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(merged)) as unknown;
  } catch {
    throw new Error("invalid translation JSON");
  }
}

function mergeSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new Error(`translation timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const onExternal = () => {
    ctrl.abort(external?.reason ?? new Error("aborted"));
  };
  if (external) {
    if (external.aborted) onExternal();
    else external.addEventListener("abort", onExternal, { once: true });
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternal);
    },
  };
}

/**
 * Translate a short selection via Bing Edge (default) or Google gtx.
 * No cookies, credentials, redirects, or automatic provider switching.
 */
export async function translateSelectionText(
  text: string,
  options?: {
    readonly target?: SelectionTranslateTarget;
    readonly provider?: SelectionTranslateProvider;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  },
): Promise<SelectionTranslateResult | SelectionTranslateError> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "empty selection" };
  }
  if (trimmed.length > MAX_CHARS) {
    return {
      ok: false,
      error: `selection exceeds ${MAX_CHARS} characters`,
    };
  }
  const provider = options?.provider ?? "bing";
  const target = options?.target ?? pickTarget(trimmed);
  const to = languageFor(target, provider);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cancel } = mergeSignals(options?.signal, timeoutMs);
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    let url: URL;
    let init: RequestInit;
    if (provider === "google") {
      url = new URL(GOOGLE_ENDPOINT);
      const form = new URLSearchParams({
        client: "gtx",
        sl: "auto",
        tl: to,
        dt: "t",
        q: trimmed,
      });
      init = {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        credentials: "omit",
        redirect: "error",
        signal,
      };
    } else {
      url = new URL(BING_ENDPOINT);
      url.searchParams.set("to", to);
      url.searchParams.set("isEnterpriseClient", "false");
      init = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([trimmed]),
        credentials: "omit",
        redirect: "error",
        signal,
      };
    }
    const res = await fetchImpl(url.href, init);
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, error: `translate HTTP ${res.status}` };
    }
    const json = await readJsonBounded(res, MAX_RESPONSE_BYTES);
    const translated =
      provider === "google" ? parseGoogleBody(json) : parseBingBody(json);
    return { ok: true, text: translated, target, provider };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    cancel();
  }
}
