/**
 * OpenAI-compatible DeepSeek Files API transport (DSH `dsh-v0.1.1-rc.2`).
 */
import { LlmError } from "@xrkseek/llm";
import type { ImageMediaType } from "@xrkseek/protocol";
import { deepSeekFileId, type DeepSeekFileId } from "./file-id.js";

export const MIN_FILE_EXPIRY_SECONDS = 3_600;
export const MAX_FILE_EXPIRY_SECONDS = 2_592_000;
export const MAX_FILE_UPLOAD_BYTES = 128 * 1024 * 1024;

export interface DeepSeekFileObject {
  readonly id: DeepSeekFileId;
  readonly bytes: number;
  readonly createdAt: number;
  readonly filename: string;
  readonly purpose: "user_data";
  readonly expiresAt?: number;
}

export class DeepSeekFilesError extends LlmError {
  readonly detail: string;

  constructor(message: string, status: number, detail: string) {
    super(
      message,
      status === 401 || status === 403
        ? "AUTH"
        : status === 429
          ? "RATE_LIMIT"
          : status >= 500
            ? "SERVER"
            : "FILES_API",
      { status },
    );
    this.name = "DeepSeekFilesError";
    this.detail = detail;
  }
}

export function isFilesQuotaError(error: unknown): error is DeepSeekFilesError {
  return (
    error instanceof DeepSeekFilesError &&
    /(?:quota|storage|stored files|file count|too many files)/iu.test(
      error.detail,
    )
  );
}

interface WireFileObject {
  id?: unknown;
  object?: unknown;
  bytes?: unknown;
  created_at?: unknown;
  filename?: unknown;
  purpose?: unknown;
  expires_at?: unknown;
}

function invalidResponse(operation: string): LlmError {
  return new LlmError(
    `DeepSeek Files API returned an invalid ${operation} response.`,
    "INVALID_RESPONSE",
  );
}

function parseFileObject(value: unknown, operation: string): DeepSeekFileObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse(operation);
  }
  const wire = value as WireFileObject;
  if (
    typeof wire.id !== "string" ||
    wire.id.length === 0 ||
    wire.object !== "file" ||
    !Number.isSafeInteger(wire.bytes) ||
    (wire.bytes as number) < 0 ||
    !Number.isSafeInteger(wire.created_at) ||
    (wire.created_at as number) < 0 ||
    typeof wire.filename !== "string" ||
    wire.filename.length === 0 ||
    wire.purpose !== "user_data" ||
    (wire.expires_at !== undefined &&
      (!Number.isSafeInteger(wire.expires_at) ||
        (wire.expires_at as number) < 0))
  ) {
    throw invalidResponse(operation);
  }
  return {
    id: deepSeekFileId(wire.id),
    bytes: wire.bytes as number,
    createdAt: wire.created_at as number,
    filename: wire.filename,
    purpose: "user_data",
    ...(wire.expires_at === undefined
      ? {}
      : { expiresAt: wire.expires_at as number }),
  };
}

function providerErrorDetail(value: unknown): {
  message?: string;
  detail: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { detail: "" };
  }
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== "object" || Array.isArray(error)) {
    return { detail: "" };
  }
  const fields = error as { message?: unknown; type?: unknown; code?: unknown };
  const message =
    typeof fields.message === "string" ? fields.message : undefined;
  return {
    ...(message === undefined ? {} : { message }),
    detail: [fields.code, fields.type, fields.message]
      .filter((field): field is string => typeof field === "string")
      .join(" "),
  };
}

export interface DeepSeekFilesClientOptions {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

/** Direct client for `/files` on the official DeepSeek host. */
export class DeepSeekFilesClient {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekFilesClientOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/u, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${this.apiKey}`);
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        ...init,
        headers,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (signal?.aborted) throw error;
      throw new LlmError(
        `DeepSeek Files API request to ${this.baseURL} failed`,
        "TRANSPORT",
        { cause: error },
      );
    }
    if (response.ok) return response;
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      /* status is enough */
    }
    const { message, detail } = providerErrorDetail(parsed);
    throw new DeepSeekFilesError(
      message ?? `DeepSeek Files API error (HTTP ${response.status})`,
      response.status,
      detail,
    );
  }

  async upload(input: {
    readonly data: Uint8Array;
    readonly mediaType: ImageMediaType;
    readonly filename: string;
    readonly expiresAfterSeconds: number;
    readonly signal?: AbortSignal;
  }): Promise<DeepSeekFileObject & { expiresAt: number }> {
    if (input.data.byteLength > MAX_FILE_UPLOAD_BYTES) {
      throw new LlmError(
        "DeepSeek Files API upload exceeds 128 MiB.",
        "INVALID_REQUEST",
      );
    }
    if (
      !Number.isSafeInteger(input.expiresAfterSeconds) ||
      input.expiresAfterSeconds < MIN_FILE_EXPIRY_SECONDS ||
      input.expiresAfterSeconds > MAX_FILE_EXPIRY_SECONDS
    ) {
      throw new LlmError(
        "DeepSeek file expiry must be between 3600 and 2592000 seconds.",
        "INVALID_REQUEST",
      );
    }
    const form = new FormData();
    form.set("purpose", "user_data");
    form.set("expires_after[anchor]", "created_at");
    form.set("expires_after[seconds]", String(input.expiresAfterSeconds));
    form.set(
      "file",
      new Blob([Uint8Array.from(input.data).buffer], {
        type: input.mediaType,
      }),
      input.filename,
    );
    const response = await this.request(
      "/files",
      { method: "POST", body: form },
      input.signal,
    );
    const file = parseFileObject(await response.json(), "upload");
    if (file.expiresAt === undefined) throw invalidResponse("upload");
    return { ...file, expiresAt: file.expiresAt };
  }

  async list(
    options: {
      readonly after?: DeepSeekFileId;
      readonly limit?: number;
      readonly order?: "asc" | "desc";
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<{
    readonly data: DeepSeekFileObject[];
    readonly hasMore: boolean;
    readonly lastId?: DeepSeekFileId;
  }> {
    const query = new URLSearchParams({ purpose: "user_data" });
    if (options.after !== undefined) query.set("after", options.after);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.order !== undefined) query.set("order", options.order);
    const response = await this.request(
      `/files?${query.toString()}`,
      { method: "GET" },
      options.signal,
    );
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw invalidResponse("list");
    }
    const wire = value as {
      object?: unknown;
      data?: unknown;
      last_id?: unknown;
      has_more?: unknown;
    };
    if (
      wire.object !== "list" ||
      !Array.isArray(wire.data) ||
      typeof wire.has_more !== "boolean" ||
      (wire.last_id !== undefined && typeof wire.last_id !== "string")
    ) {
      throw invalidResponse("list");
    }
    return {
      data: wire.data.map((item) => parseFileObject(item, "list")),
      hasMore: wire.has_more,
      ...(typeof wire.last_id === "string"
        ? { lastId: deepSeekFileId(wire.last_id) }
        : {}),
    };
  }

  async delete(fileId: DeepSeekFileId, signal?: AbortSignal): Promise<void> {
    const response = await this.request(
      `/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
      signal,
    );
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw invalidResponse("delete");
    }
    const wire = value as { id?: unknown; object?: unknown; deleted?: unknown };
    if (
      wire.id !== fileId ||
      wire.object !== "file" ||
      wire.deleted !== true
    ) {
      throw invalidResponse("delete");
    }
  }
}
