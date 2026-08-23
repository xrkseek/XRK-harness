/**
 * Local durable attachment backend under `{XRK_HOME}/attachments/v1`.
 */
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  AttachmentError,
  type AttachmentStore,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
  type ImageRequestPolicy,
  type RequestImageAttachment,
  type SaveImageAttachment,
  type StoredImageAttachment,
} from "@xrkseek/attachment";
import { CompressionLimiter } from "./compression-limiter.js";
import type { NormalizationPolicy } from "./normalization.js";
import {
  commitPreparedImageFile,
  prepareImageFile,
  readImageByAttachmentId,
  readImageFile,
  validateImageFile,
} from "./store.js";
import { readRequestImageFile, requestImageVariantId } from "./request-image.js";

export { canPassThroughNormalization, normalizeImage } from "./normalization.js";
export type { NormalizedImage, NormalizationPolicy } from "./normalization.js";
export {
  commitPreparedImageFile,
  prepareImageFile,
  readImageFile,
  validateImageFile,
} from "./store.js";
export type { PreparedImageFile } from "./store.js";
export {
  readRequestImageFile,
  requestImageDimensions,
  requestImageVariantId,
  REQUEST_IMAGE_TRANSFORM_VERSION,
} from "./request-image.js";

export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20;
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_PIXELS = 64_000_000;
export const DEFAULT_MAX_IMAGE_DIMENSION = 8192;
export const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 2048;
export const DEFAULT_NORMALIZED_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_IMAGE_COMPRESSION_CONCURRENCY = 2;
export const MAX_IMAGE_COMPRESSION_CONCURRENCY = 8;

export interface CreateLocalAttachmentStoreOptions {
  /** Explicit XRK home; default `XRK_HOME` or `~/.xrk`. */
  readonly xrkHome?: string;
  readonly maxImageBytes?: number;
  readonly maxImagesPerMessage?: number;
  readonly maxMessageImageBytes?: number;
  readonly maxImagePixels?: number;
  readonly maxImageDimension?: number;
  readonly normalizedImageMaxDimension?: number;
  readonly normalizedImageMaxBytes?: number;
  readonly imageCompressionConcurrency?: number;
}

function resolveAttachmentsRoot(xrkHome?: string): string {
  const home =
    xrkHome?.trim() ||
    process.env.XRK_HOME?.trim() ||
    join(homedir(), ".xrk");
  return resolve(join(home, "attachments", "v1"));
}

class SharedRequest<T> {
  readonly controller = new AbortController();
  readonly promise: Promise<T>;
  private settled = false;
  private waiters = 0;

  constructor(start: (signal: AbortSignal) => Promise<T>) {
    this.promise = start(this.controller.signal).finally(() => {
      this.settled = true;
    });
  }

  wait(signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    this.waiters += 1;
    if (signal === undefined) {
      return this.promise.finally(() => {
        this.release(false);
      });
    }
    let released = false;
    const release = (cancelled: boolean): void => {
      if (released) return;
      released = true;
      this.release(cancelled, signal);
    };
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        release(true);
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new Error("Attachment request cancelled.", { cause: reason }),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      void this.promise.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          release(false);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          release(false);
          reject(
            error instanceof Error
              ? error
              : new Error(String(error), { cause: error }),
          );
        },
      );
    });
  }

  private release(cancelled: boolean, signal?: AbortSignal): void {
    this.waiters -= 1;
    if (
      cancelled &&
      this.waiters === 0 &&
      !this.settled &&
      signal !== undefined
    ) {
      const reason: unknown = signal.reason;
      this.controller.abort(
        reason instanceof Error
          ? reason
          : new Error(String(reason), { cause: reason }),
      );
    }
  }
}

/**
 * Disk-backed attachment store with sharp normalization + request-image cache.
 */
export function createLocalAttachmentStore(
  options: CreateLocalAttachmentStoreOptions = {},
): AttachmentStore {
  const root = resolveAttachmentsRoot(options.xrkHome);
  const imageLimits: ImageAttachmentLimits = {
    maxImageBytes: options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxImagesPerMessage:
      options.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
    maxMessageImageBytes:
      options.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
    maxImagePixels: options.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
    maxImageDimension: options.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION,
    mediaTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ],
  };
  const normalizationPolicy: Readonly<NormalizationPolicy> = {
    maxDimension:
      options.normalizedImageMaxDimension ??
      DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
    maxBytes:
      options.normalizedImageMaxBytes ?? DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
  };
  const compressionConcurrency =
    options.imageCompressionConcurrency ?? DEFAULT_IMAGE_COMPRESSION_CONCURRENCY;
  if (
    !Number.isSafeInteger(compressionConcurrency) ||
    compressionConcurrency < 1 ||
    compressionConcurrency > MAX_IMAGE_COMPRESSION_CONCURRENCY
  ) {
    throw new Error(
      `attachment-local: imageCompressionConcurrency must be 1..${MAX_IMAGE_COMPRESSION_CONCURRENCY}`,
    );
  }
  const compression = new CompressionLimiter(compressionConcurrency);
  const requestInflight = new Map<string, SharedRequest<RequestImageAttachment>>();

  function validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    if (inputs.length > imageLimits.maxImagesPerMessage) {
      throw new AttachmentError(
        "Image batch exceeds the configured image-count limit.",
        "TOO_MANY_IMAGES",
      );
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0);
    if (totalBytes > imageLimits.maxMessageImageBytes) {
      throw new AttachmentError(
        "Image batch exceeds the configured aggregate image-byte limit.",
        "IMAGES_TOO_LARGE",
      );
    }
    for (const input of inputs) {
      if (!imageLimits.mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(
          `Image type ${input.mediaType} is not accepted.`,
          "UNSUPPORTED_IMAGE_TYPE",
        );
      }
    }
  }

  async function readImageById(
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<StoredImageAttachment> {
    try {
      return await readImageByAttachmentId(root, attachmentId, signal);
    } catch (err) {
      if (
        err instanceof AttachmentError &&
        err.code === "ATTACHMENT_NOT_FOUND"
      ) {
        throw new AttachmentError(
          `Attachment not found: ${attachmentId}`,
          "NOT_FOUND",
        );
      }
      throw err;
    }
  }

  return {
    imageLimits,
    async validateImage(input: SaveImageAttachment): Promise<void> {
      await compression.run(() =>
        validateImageFile(input, imageLimits, normalizationPolicy),
      );
    },
    async saveImages(
      inputs: readonly SaveImageAttachment[],
    ): Promise<readonly ImageAttachmentRef[]> {
      validateImageBatch(inputs);
      const prepared = await Promise.all(
        inputs.map((input) =>
          compression.run(() =>
            prepareImageFile(input, imageLimits, normalizationPolicy),
          ),
        ),
      );
      const refs: ImageAttachmentRef[] = [];
      for (const image of prepared) {
        refs.push(await commitPreparedImageFile(root, image));
      }
      return refs;
    },
    async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
      const prepared = await compression.run(() =>
        prepareImageFile(input, imageLimits, normalizationPolicy),
      );
      return commitPreparedImageFile(root, prepared);
    },
    readImage: readImageById,
    async readImageRequest(
      ref: ImageAttachmentRef,
      policy: ImageRequestPolicy,
      signal?: AbortSignal,
    ): Promise<RequestImageAttachment> {
      signal?.throwIfAborted();
      const variantId = requestImageVariantId(ref, policy);
      const key = variantId;
      let operation = requestInflight.get(key);
      if (operation?.controller.signal.aborted) {
        requestInflight.delete(key);
        operation = undefined;
      }
      if (operation === undefined) {
        const shared = new SharedRequest<RequestImageAttachment>(
          (sharedSignal) =>
            compression.run(async () =>
              readRequestImageFile(
                root,
                await readImageFile(root, ref, sharedSignal),
                policy,
                sharedSignal,
              ),
            ),
        );
        operation = shared;
        requestInflight.set(key, shared);
        void shared.promise
          .finally(() => {
            if (requestInflight.get(key) === shared) requestInflight.delete(key);
          })
          .catch(() => {});
      }
      return operation.wait(signal);
    },
  };
}
