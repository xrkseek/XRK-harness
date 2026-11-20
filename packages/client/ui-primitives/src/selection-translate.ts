/**
 * Anonymous selection translation — no API key, no settings.
 *
 * Product path races Bing + Youdao first (intl / mainland CN), then
 * MyMemory + Google. Failures stay silent at the call site; callers only
 * surface a successful translation.
 */

const BING_ENDPOINT = "https://edge.microsoft.com/translate/translatetext";
const YOUDAO_ENDPOINT = "https://aidemo.youdao.com/trans";
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const MAX_CHARS = 4000;
/** MyMemory anonymous `q` hard limit (bytes). Larger selections skip this provider. */
const MYMEMORY_MAX_BYTES = 500;
const MAX_RESPONSE_BYTES = 1_048_576;
/** Per-provider budget inside a race wave (auto path). */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Built-in anonymous backends. Prefer Bing; Youdao for mainland CN reachability;
 * MyMemory / Google as further fallbacks.
 */
export const SELECTION_TRANSLATE_PROVIDERS = [
  "bing",
  "youdao",
  "mymemory",
  "google",
] as const;

export type SelectionTranslateProvider =
  (typeof SELECTION_TRANSLATE_PROVIDERS)[number];

/** Default zero-config order (documentation / single-provider pin). */
export const SELECTION_TRANSLATE_AUTO_CHAIN: readonly SelectionTranslateProvider[] =
  SELECTION_TRANSLATE_PROVIDERS;

/** Wave 1: reach both intl and mainland CN in parallel. */
const AUTO_WAVE_PRIMARY: readonly SelectionTranslateProvider[] = [
  "bing",
  "youdao",
];

/** Wave 2: additional anonymous CORS-open backends. */
const AUTO_WAVE_FALLBACK: readonly SelectionTranslateProvider[] = [
  "mymemory",
  "google",
];

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

type TranslateAttempt = {
  readonly url: string;
  readonly init: RequestInit;
  readonly parse: (payload: unknown) => string;
};

function pickTarget(source: string): SelectionTranslateTarget {
  // CJK / kana / hangul → English; otherwise → Simplified Chinese.
  const asian =
    (source.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  return asian >= Math.max(1, source.length * 0.2) ? "en" : "zh-Hans";
}

function alternateTarget(
  target: SelectionTranslateTarget,
): SelectionTranslateTarget {
  return target === "en" ? "zh-Hans" : "en";
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function hasAsianScript(text: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

function hasLatinLetter(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/** Exact echo (after trim) is a soft miss so the auto path can flip direction. */
function isNoOpTranslation(source: string, translated: string): boolean {
  return source.trim() === translated.trim();
}

/**
 * Reject results that do not move the selection toward the requested target.
 * Stops the auto flip from "succeeding" with Latin→Latin noise (OK / API / HELLO).
 */
function isUselessForTarget(
  source: string,
  translated: string,
  target: SelectionTranslateTarget,
): boolean {
  if (isNoOpTranslation(source, translated)) return true;
  if (target === "en") {
    // Asian → English must introduce Latin; Latin → English is not a translation.
    return !hasLatinLetter(translated) || !hasAsianScript(source);
  }
  // Targeting Chinese: require CJK in the output.
  return !hasAsianScript(translated);
}

function languageFor(
  target: SelectionTranslateTarget,
  provider: SelectionTranslateProvider,
): string {
  switch (provider) {
    case "google":
    case "mymemory":
      return target === "zh-Hans" ? "zh-CN" : target === "zh-Hant" ? "zh-TW" : "en";
    case "youdao":
      return target === "zh-Hans" ? "zh-CHS" : target === "zh-Hant" ? "zh-CHT" : "en";
    case "bing":
      return target;
  }
}

function requireNonEmpty(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty translation");
  return trimmed;
}

function parseBingBody(payload: unknown): string {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("invalid bing translation response");
  }
  const first = payload[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("translations" in first) ||
    !Array.isArray((first as { translations: unknown }).translations)
  ) {
    throw new Error("invalid bing translation response");
  }
  const translated = (first as { translations: unknown[] }).translations[0];
  if (
    typeof translated !== "object" ||
    translated === null ||
    !("text" in translated) ||
    typeof (translated as { text: unknown }).text !== "string"
  ) {
    throw new Error("invalid bing translation response");
  }
  return requireNonEmpty((translated as { text: string }).text);
}

function parseGoogleBody(payload: unknown): string {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("invalid google translation response");
  }
  const segments = payload[0];
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("invalid google translation response");
  }
  return requireNonEmpty(
    segments
      .map((segment) => {
        if (!Array.isArray(segment)) {
          throw new Error("invalid google translation response");
        }
        const text = segment[0];
        if (typeof text !== "string") {
          throw new Error("invalid google translation response");
        }
        return text;
      })
      .join(""),
  );
}

function parseYoudaoBody(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid youdao translation response");
  }
  const body = payload as {
    errorCode?: unknown;
    translation?: unknown;
  };
  if (body.errorCode !== undefined && String(body.errorCode) !== "0") {
    throw new Error(`youdao errorCode ${String(body.errorCode)}`);
  }
  if (!Array.isArray(body.translation) || body.translation.length === 0) {
    throw new Error("invalid youdao translation response");
  }
  const parts = body.translation.map((item) => {
    if (typeof item !== "string") {
      throw new Error("invalid youdao translation response");
    }
    return item;
  });
  return requireNonEmpty(parts.join(""));
}

function parseMyMemoryBody(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid mymemory translation response");
  }
  const body = payload as {
    responseStatus?: unknown;
    responseDetails?: unknown;
    responseData?: unknown;
  };
  const status = Number(body.responseStatus);
  if (status !== 200) {
    const detail =
      typeof body.responseDetails === "string" && body.responseDetails
        ? body.responseDetails
        : `status ${String(body.responseStatus)}`;
    throw new Error(`mymemory ${detail}`);
  }
  if (
    typeof body.responseData !== "object" ||
    body.responseData === null ||
    !("translatedText" in body.responseData) ||
    typeof (body.responseData as { translatedText: unknown }).translatedText !==
      "string"
  ) {
    throw new Error("invalid mymemory translation response");
  }
  const text = requireNonEmpty(
    (body.responseData as { translatedText: string }).translatedText,
  );
  // MyMemory sometimes echoes quota/limit copy as "translatedText".
  if (/QUERY LENGTH LIMIT|PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(text)) {
    throw new Error(`mymemory ${text}`);
  }
  return text;
}

function buildAttempt(
  provider: SelectionTranslateProvider,
  text: string,
  target: SelectionTranslateTarget,
  signal: AbortSignal,
): TranslateAttempt | null {
  const to = languageFor(target, provider);
  const common: Pick<RequestInit, "credentials" | "redirect" | "signal"> = {
    credentials: "omit",
    redirect: "error",
    signal,
  };

  switch (provider) {
    case "bing": {
      const url = new URL(BING_ENDPOINT);
      url.searchParams.set("to", to);
      url.searchParams.set("isEnterpriseClient", "false");
      return {
        url: url.href,
        init: {
          ...common,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([text]),
        },
        parse: parseBingBody,
      };
    }
    case "youdao": {
      const form = new URLSearchParams({
        q: text,
        from: "Auto",
        to,
      });
      return {
        url: YOUDAO_ENDPOINT,
        init: {
          ...common,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: form.toString(),
        },
        parse: parseYoudaoBody,
      };
    }
    case "mymemory": {
      if (utf8ByteLength(text) > MYMEMORY_MAX_BYTES) return null;
      const url = new URL(MYMEMORY_ENDPOINT);
      url.searchParams.set("q", text);
      url.searchParams.set("langpair", `Autodetect|${to}`);
      return {
        url: url.href,
        init: {
          ...common,
          method: "GET",
        },
        parse: parseMyMemoryBody,
      };
    }
    case "google": {
      const form = new URLSearchParams({
        client: "gtx",
        sl: "auto",
        tl: to,
        dt: "t",
        q: text,
      });
      return {
        url: GOOGLE_ENDPOINT,
        init: {
          ...common,
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        },
        parse: parseGoogleBody,
      };
    }
  }
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
    /** Abort in-flight work (race losers / superseded calls) and drop the timer. */
    cancel: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternal);
      if (!ctrl.signal.aborted) {
        ctrl.abort(new Error("translation superseded"));
      }
    },
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

async function attemptProvider(
  provider: SelectionTranslateProvider,
  text: string,
  target: SelectionTranslateTarget,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const attempt = buildAttempt(provider, text, target, signal);
  if (attempt === null) {
    throw new Error(`${provider} skipped (selection too large)`);
  }
  const res = await fetchImpl(attempt.url, attempt.init);
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${provider} HTTP ${res.status}`);
  }
  const json = await readJsonBounded(res, MAX_RESPONSE_BYTES);
  const translated = attempt.parse(json);
  if (isUselessForTarget(text, translated, target)) {
    throw new Error(`${provider} useless translation for ${target}`);
  }
  return translated;
}

/**
 * Race one wave: first real translation wins; losers are aborted.
 * Soft misses (network / parse / no-op) never surface — only exhaustion does.
 */
async function raceWave(
  providers: readonly SelectionTranslateProvider[],
  text: string,
  target: SelectionTranslateTarget,
  fetchImpl: typeof fetch,
  external: AbortSignal | undefined,
  timeoutMs: number,
): Promise<
  | { readonly ok: true; readonly text: string; readonly provider: SelectionTranslateProvider }
  | { readonly ok: false; readonly failures: readonly string[] }
> {
  if (providers.length === 0) {
    return { ok: false, failures: [] };
  }
  if (providers.length === 1) {
    const provider = providers[0]!;
    const { signal, cancel } = mergeSignals(external, timeoutMs);
    try {
      const translated = await attemptProvider(
        provider,
        text,
        target,
        fetchImpl,
        signal,
      );
      return { ok: true, text: translated, provider };
    } catch (err) {
      return { ok: false, failures: [`${provider}: ${errorMessage(err)}`] };
    } finally {
      cancel();
    }
  }

  const failures: string[] = [];
  const cancels: Array<() => void> = [];
  let settled = false;

  return await new Promise((resolve) => {
    let pending = providers.length;

    const finishMiss = (): void => {
      pending -= 1;
      if (!settled && pending === 0) {
        settled = true;
        for (const cancel of cancels) cancel();
        resolve({ ok: false, failures });
      }
    };

    for (const provider of providers) {
      const { signal, cancel } = mergeSignals(external, timeoutMs);
      cancels.push(cancel);
      void attemptProvider(provider, text, target, fetchImpl, signal)
        .then((translated) => {
          if (settled) return;
          settled = true;
          for (const other of cancels) other();
          resolve({ ok: true, text: translated, provider });
        })
        .catch((err: unknown) => {
          failures.push(`${provider}: ${errorMessage(err)}`);
          finishMiss();
        });
    }
  });
}

async function translateWithTargets(
  text: string,
  targets: readonly SelectionTranslateTarget[],
  waves: readonly (readonly SelectionTranslateProvider[])[],
  fetchImpl: typeof fetch,
  external: AbortSignal | undefined,
  timeoutMs: number,
): Promise<SelectionTranslateResult | SelectionTranslateError> {
  const failures: string[] = [];
  for (const target of targets) {
    if (external?.aborted) {
      return {
        ok: false,
        error: errorMessage(external.reason ?? new Error("aborted")),
      };
    }
    for (const wave of waves) {
      const round = await raceWave(
        wave,
        text,
        target,
        fetchImpl,
        external,
        timeoutMs,
      );
      if (round.ok) {
        return {
          ok: true,
          text: round.text,
          target,
          provider: round.provider,
        };
      }
      failures.push(...round.failures);
    }
  }
  return {
    ok: false,
    error:
      failures.length === 0
        ? "no translation providers"
        : failures.join("; "),
  };
}

/**
 * Translate a short selection via anonymous public backends.
 * Omitting `provider` (or `"auto"`) races Bing∥Youdao, then MyMemory∥Google,
 * and silently retries the opposite language direction when the first pass
 * only echoes the source. No cookies, credentials, or redirects.
 */
export async function translateSelectionText(
  text: string,
  options?: {
    readonly target?: SelectionTranslateTarget;
    readonly provider?: SelectionTranslateProvider | "auto";
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

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const primary = options?.target ?? pickTarget(trimmed);

  if (options?.provider !== undefined && options.provider !== "auto") {
    return translateWithTargets(
      trimmed,
      options.target !== undefined ? [primary] : [primary, alternateTarget(primary)],
      [[options.provider]],
      fetchImpl,
      options.signal,
      timeoutMs,
    );
  }

  // Auto / default: race waves, then flip direction once if needed.
  const targets =
    options?.target !== undefined
      ? [primary]
      : ([primary, alternateTarget(primary)] as const);

  return translateWithTargets(
    trimmed,
    targets,
    [AUTO_WAVE_PRIMARY, AUTO_WAVE_FALLBACK],
    fetchImpl,
    options?.signal,
    timeoutMs,
  );
}
