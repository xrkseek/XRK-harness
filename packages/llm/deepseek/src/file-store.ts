/**
 * DeepSeek Files API upload reuse (DSH `dsh-v0.1.1-rc.2`).
 */
import { createHash } from "node:crypto";
import type { ImageMediaType } from "@xrkseek/protocol";
import { LlmError } from "@xrkseek/llm";
import {
  DeepSeekFilesClient,
  isFilesQuotaError,
} from "./files-api.js";
import type { DeepSeekFileId } from "./file-id.js";
import {
  deepSeekFileScope,
  DeepSeekUploadIndex,
  imageVariantId,
  type DeepSeekUploadRecord,
  type ImageVariantId,
} from "./upload-index.js";

export const MAX_CHAT_IMAGE_BYTES = 32 * 1024 * 1024;
const OWNED_FILE_PREFIX = "xrk-";

export interface DeepSeekFilePolicy {
  readonly expiresAfterSeconds: number;
  readonly refreshMarginSeconds: number;
  readonly quotaCleanupBatch: number;
}

export const DEFAULT_DEEPSEEK_FILE_POLICY: DeepSeekFilePolicy = {
  expiresAfterSeconds: 86_400,
  refreshMarginSeconds: 3_600,
  quotaCleanupBatch: 10,
};

export interface DeepSeekFileConnection {
  readonly baseURL: string;
  readonly apiKey: string;
}

export interface RequestImageVersion {
  readonly attachmentId: string;
  readonly variantId: ImageVariantId;
  readonly mediaType: ImageMediaType;
  readonly data: Uint8Array;
  readonly bytes: number;
}

export function requestImageVariantId(
  attachmentId: string,
  data: Uint8Array,
  mediaType: ImageMediaType,
): ImageVariantId {
  const digest = createHash("sha256")
    .update(attachmentId)
    .update("\0")
    .update(mediaType)
    .update(data)
    .digest("hex");
  return imageVariantId(`sha256:${digest}`);
}

function extension(mediaType: ImageMediaType): "png" | "jpeg" | "webp" | "gif" {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpeg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function filename(version: RequestImageVersion): string {
  const attachment = version.attachmentId
    .slice("sha256:".length, "sha256:".length + 16);
  const variant = version.variantId
    .slice("sha256:".length, "sha256:".length + 8);
  return `${OWNED_FILE_PREFIX}${attachment}-${variant}.${extension(version.mediaType)}`;
}

export class DeepSeekFileStore {
  private readonly index: DeepSeekUploadIndex;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly inflight = new Map<
    string,
    { promise: Promise<{ record: DeepSeekUploadRecord; uploaded: boolean }> }
  >();

  constructor(options: {
    readonly index?: DeepSeekUploadIndex;
    readonly now?: () => number;
    readonly fetch?: typeof fetch;
  } = {}) {
    this.index = options.index ?? new DeepSeekUploadIndex();
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetch;
  }

  private client(connection: DeepSeekFileConnection): DeepSeekFilesClient {
    return new DeepSeekFilesClient({
      baseURL: connection.baseURL,
      apiKey: connection.apiKey,
      ...(this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl }),
    });
  }

  async ensureUploaded(
    version: RequestImageVersion,
    connection: DeepSeekFileConnection,
    policy: DeepSeekFilePolicy,
    signal?: AbortSignal,
  ): Promise<{ record: DeepSeekUploadRecord; uploaded: boolean }> {
    signal?.throwIfAborted();
    const scope = deepSeekFileScope(connection.baseURL, connection.apiKey);
    const key = `${scope}\0${version.variantId}`;
    const active = this.inflight.get(key);
    if (active !== undefined) return active.promise;

    const promise = this.ensureUploadedOnce(
      version,
      connection,
      policy,
      signal,
    );
    this.inflight.set(key, { promise });
    try {
      return await promise;
    } finally {
      if (this.inflight.get(key)?.promise === promise) {
        this.inflight.delete(key);
      }
    }
  }

  private async ensureUploadedOnce(
    version: RequestImageVersion,
    connection: DeepSeekFileConnection,
    policy: DeepSeekFilePolicy,
    signal?: AbortSignal,
  ): Promise<{ record: DeepSeekUploadRecord; uploaded: boolean }> {
    if (version.bytes > MAX_CHAT_IMAGE_BYTES) {
      throw new LlmError(
        "DeepSeek chat image exceeds the 32 MiB per-image limit.",
        "INVALID_REQUEST",
      );
    }
    const scope = deepSeekFileScope(connection.baseURL, connection.apiKey);
    const now = this.now();
    const marginMs = policy.refreshMarginSeconds * 1_000;
    const cached = await this.index.get(scope, version.variantId, now, marginMs);
    if (cached !== undefined) return { record: cached, uploaded: false };

    const client = this.client(connection);
    const upload = async (): Promise<DeepSeekUploadRecord> => {
      const remote = await client.upload({
        data: version.data,
        mediaType: version.mediaType,
        filename: filename(version),
        expiresAfterSeconds: policy.expiresAfterSeconds,
        ...(signal === undefined ? {} : { signal }),
      });
      if (remote.bytes !== version.data.byteLength) {
        throw new LlmError(
          "DeepSeek Files API upload response does not match the submitted image.",
          "INVALID_RESPONSE",
        );
      }
      return {
        scope,
        attachmentId: version.attachmentId,
        variantId: version.variantId,
        fileId: remote.id,
        bytes: remote.bytes,
        createdAt: remote.createdAt * 1_000,
        expiresAt: remote.expiresAt * 1_000,
      };
    };

    let candidate: DeepSeekUploadRecord;
    try {
      candidate = await upload();
    } catch (error: unknown) {
      if (!isFilesQuotaError(error)) throw error;
      const deleted = await this.reclaimOldestOwned(
        connection,
        policy.quotaCleanupBatch,
        signal,
      );
      if (deleted === 0) throw error;
      candidate = await upload();
    }

    const committed = await this.index.commit(candidate, now, marginMs);
    if (!committed.accepted) {
      try {
        await client.delete(candidate.fileId, signal);
      } catch {
        /* duplicate cleanup is best-effort */
      }
    }
    return { record: committed.record, uploaded: committed.accepted };
  }

  private async reclaimOldestOwned(
    connection: DeepSeekFileConnection,
    count: number,
    signal?: AbortSignal,
  ): Promise<number> {
    const client = this.client(connection);
    let after: DeepSeekFileId | undefined;
    const owned: DeepSeekFileId[] = [];
    while (owned.length < count) {
      const page = await client.list({
        ...(after === undefined ? {} : { after }),
        limit: 1_000,
        order: "asc",
        ...(signal === undefined ? {} : { signal }),
      });
      for (const file of page.data) {
        if (!file.filename.startsWith(OWNED_FILE_PREFIX)) continue;
        owned.push(file.id);
        if (owned.length === count) break;
      }
      if (!page.hasMore || page.lastId === undefined || page.lastId === after) {
        break;
      }
      after = page.lastId;
    }
    for (const fileId of owned) {
      await client.delete(fileId, signal);
    }
    return owned.length;
  }
}
