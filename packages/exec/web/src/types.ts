export class WebError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "WebError";
    this.code = code;
  }
}

export function isWebError(err: unknown): err is WebError {
  return err instanceof WebError;
}

export interface WebSearchSource {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly publishedAt?: string;
}

export interface WebSearchRequest {
  readonly query: string;
  readonly maxResults: number;
}

export interface WebSearchResult {
  readonly sources: readonly WebSearchSource[];
  readonly truncated: boolean;
  readonly content?: string;
}

export interface WebSearch {
  search(
    request: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebSearchResult>;
}

export interface WebFetchRequest {
  readonly url: string;
  /**
   * Optional HTTP(S) proxy URL (e.g. `http://127.0.0.1:7897`).
   * When omitted, process `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` apply if
   * the Host installed undici's EnvHttpProxyAgent.
   */
  readonly proxy?: string;
}

export type WebFetchBody =
  | { readonly kind: "html"; readonly content: string }
  | { readonly kind: "text"; readonly content: string }
  /** Binary (image/pdf/…): metadata only — body is never decoded into the model. */
  | {
      readonly kind: "binary";
      readonly contentType: string;
      readonly byteLength: number | null;
      readonly content: string;
    };

export interface WebFetchResult {
  readonly url: string;
  readonly statusCode: number;
  readonly truncated: boolean;
  readonly body: WebFetchBody;
}

export interface WebFetch {
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
}

export interface WebAccess {
  readonly search?: WebSearch;
  readonly fetch: WebFetch;
}

export type FetchFn = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
