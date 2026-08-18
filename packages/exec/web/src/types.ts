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
}

export type WebFetchBody =
  | { readonly kind: "html"; readonly content: string }
  | { readonly kind: "text"; readonly content: string };

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
