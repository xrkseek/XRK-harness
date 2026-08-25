import { capText } from "./html-text.js";
import type {
  FetchFn,
  WebFetch,
  WebFetchBody,
  WebFetchRequest,
  WebFetchResult,
} from "./types.js";
import { WebError } from "./types.js";
import { assertHttpUrl, isSameOrigin } from "./url-policy.js";

export interface HttpFetchLimits {
  readonly maxUrlLength: number;
  readonly maxResponseBytes: number;
  readonly maxBodyChars: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly userAgent: string;
}

export const DEFAULT_HTTP_FETCH_LIMITS: HttpFetchLimits = {
  maxUrlLength: 2048,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: "xrk-harness/0.0.4 (+https://github.com/xrkseek)",
};

export const LOCAL_FETCH_PROVIDER_ID = "http";

export type FetchableKind = "html" | "text";

/** `text/html` + xhtml → html; other text/* / json / xml → text; else unsupported. */
export function classifyContentType(
  contentType: string | null,
): FetchableKind | undefined {
  const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("text/")) return "text";
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  ) {
    return "text";
  }
  return undefined;
}

function charsetOf(contentType: string | null): string {
  const match = /charset=([^;]+)/i.exec(contentType ?? "");
  const raw = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!raw) return "utf-8";
  try {
    new TextDecoder(raw);
    return raw;
  } catch {
    return "utf-8";
  }
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<{ readonly bytes: Uint8Array; readonly truncated: boolean }> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel();
      throw new WebError(
        `response exceeds the maximum of ${maxBytes} bytes`,
        "WEB_FETCH_TOO_LARGE",
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        total += remaining;
        return { bytes: concat(chunks, total), truncated: true };
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: concat(chunks, total), truncated: false };
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeBody(
  bytes: Uint8Array,
  contentType: string | null,
  kind: FetchableKind,
  maxChars: number,
  byteTruncated: boolean,
): { readonly body: WebFetchBody; readonly truncated: boolean } {
  const text = new TextDecoder(charsetOf(contentType), { fatal: false }).decode(
    bytes,
  );
  const capped = capText(text, maxChars);
  return {
    body: { kind, content: capped.text },
    truncated: byteTruncated || capped.truncated,
  };
}

export function createHttpFetchProvider(
  options: {
    readonly limits?: Partial<HttpFetchLimits>;
    readonly fetch?: FetchFn;
  } = {},
): WebFetch {
  const limits = { ...DEFAULT_HTTP_FETCH_LIMITS, ...options.limits };
  const fetchFn = options.fetch ?? globalThis.fetch;
  return {
    async fetch(
      request: WebFetchRequest,
      signal?: AbortSignal,
    ): Promise<WebFetchResult> {
      if (signal?.aborted) {
        throw new WebError("web fetch aborted", "WEB_ABORTED");
      }
      let current = assertHttpUrl(request.url, limits.maxUrlLength);
      const timed = AbortSignal.timeout(limits.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timed]) : timed;
      let hops = 0;

      for (;;) {
        let response: Response;
        try {
          response = await fetchFn(current, {
            method: "GET",
            redirect: "manual",
            signal: combined,
            headers: {
              "user-agent": limits.userAgent,
              accept:
                "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8",
            },
          });
        } catch (err) {
          if (timed.aborted && !signal?.aborted) {
            throw new WebError("web fetch timed out", "WEB_FETCH_TIMEOUT");
          }
          if (combined.aborted) {
            throw new WebError("web fetch aborted", "WEB_ABORTED");
          }
          throw new WebError(
            err instanceof Error ? err.message : String(err),
            "WEB_PROVIDER_ERROR",
          );
        }

        if (isRedirect(response.status)) {
          await response.body?.cancel();
          if (hops >= limits.maxRedirects) {
            throw new WebError(
              `exceeded the maximum of ${limits.maxRedirects} redirects`,
              "WEB_REDIRECT_BLOCKED",
            );
          }
          const location = response.headers.get("location");
          if (!location) {
            throw new WebError(
              `redirect response (HTTP ${response.status}) without a Location header`,
              "WEB_PROVIDER_ERROR",
            );
          }
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            throw new WebError(
              "redirect Location is not a valid URL",
              "WEB_INVALID_URL",
            );
          }
          const validated = assertHttpUrl(next.href, limits.maxUrlLength);
          if (!isSameOrigin(current, validated)) {
            throw new WebError(
              `cross-origin redirect is not followed; call web_fetch on Location: ${validated.href}`,
              "WEB_REDIRECT_BLOCKED",
            );
          }
          current = validated;
          hops += 1;
          continue;
        }

        const kind = classifyContentType(response.headers.get("content-type"));
        if (kind === undefined) {
          await response.body?.cancel();
          throw new WebError(
            `unsupported content type "${response.headers.get("content-type") ?? "unknown"}"`,
            "WEB_UNSUPPORTED_CONTENT_TYPE",
          );
        }

        const read = await readLimited(response, limits.maxResponseBytes);
        const decoded = decodeBody(
          read.bytes,
          response.headers.get("content-type"),
          kind,
          limits.maxBodyChars,
          read.truncated,
        );
        return {
          url: current.href,
          statusCode: response.status,
          truncated: decoded.truncated,
          body: decoded.body,
        };
      }
    },
  };
}
