/**
 * Cordis `attachments` seat for community host halves (OFM image resolver +
 * channel-pack `readImage` / gateway `saveImage`).
 *
 * Bytes live in the product local store (`{XRK_HOME}/attachments/v1`).
 * `imageHostPath` is the sync path OFM's free-lane resolver stats and reads.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  createLocalAttachmentStore,
  resolveLocalAttachmentsRoot,
  storedImagePath,
} from "@xrkseek/attachment-local";

const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface CordisImageRef {
  attachmentId?: string;
  mediaType?: string;
  sourcePath?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface CordisAttachmentsBridge {
  readonly imageLimits: {
    readonly maxImageBytes: number;
    readonly maxImagesPerMessage: number;
    readonly maxMessageImageBytes: number;
    readonly maxImageDimension?: number;
    readonly mediaTypes: readonly string[];
  };
  imageHostPath(ref: CordisImageRef | undefined): string | undefined;
  readImage(ref: CordisImageRef): Promise<{
    data: Uint8Array;
    ref: { attachmentId: string; mediaType: string };
  }>;
  saveImage(input: {
    data: Uint8Array;
    mediaType: string;
  }): Promise<{ attachmentId: string; mediaType: string }>;
  readImageRequest(
    ref: CordisImageRef,
    target: { width?: number; height?: number; maxBytes?: number },
  ): Promise<{ data: Uint8Array; mediaType: string; attachment?: { mediaType: string } }>;
}

function asMedia(value: string): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  if (!MEDIA.has(value)) {
    throw new TypeError(`unsupported image media type: ${value}`);
  }
  return value as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

export function createCordisAttachmentsBridge(
  xrkHome: string,
): CordisAttachmentsBridge {
  const root = resolveLocalAttachmentsRoot(xrkHome);
  const store = createLocalAttachmentStore({ xrkHome });

  const imageHostPath = (ref: CordisImageRef | undefined): string | undefined => {
    const source = ref?.sourcePath;
    if (typeof source === "string" && source.length > 0 && existsSync(source)) {
      return source;
    }
    const id = typeof ref?.attachmentId === "string" ? ref.attachmentId : "";
    if (!id) return undefined;
    try {
      const stored = storedImagePath(root, { attachmentId: id });
      return existsSync(stored) ? stored : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    imageLimits: store.imageLimits,
    imageHostPath,
    async readImage(ref) {
      const id = typeof ref.attachmentId === "string" ? ref.attachmentId : "";
      if (id) {
        try {
          const stored = await store.readImage(id);
          return {
            data: stored.data,
            ref: {
              attachmentId: stored.ref.attachmentId,
              mediaType: stored.ref.mediaType,
            },
          };
        } catch {
          /* fall through to host path / sourcePath */
        }
      }
      const hostPath = imageHostPath(ref);
      if (!hostPath) throw new Error("attachment not found");
      const data = new Uint8Array(readFileSync(hostPath));
      const mediaType =
        typeof ref.mediaType === "string" && ref.mediaType
          ? ref.mediaType
          : "image/png";
      return {
        data,
        ref: { attachmentId: id, mediaType },
      };
    },
    async saveImage(input) {
      const saved = await store.saveImage({
        data: input.data,
        mediaType: asMedia(input.mediaType),
      });
      return { attachmentId: saved.attachmentId, mediaType: saved.mediaType };
    },
    async readImageRequest(ref, target) {
      if (store.readImageRequest === undefined) {
        throw new Error("readImageRequest unavailable");
      }
      const id = typeof ref.attachmentId === "string" ? ref.attachmentId : "";
      if (!id) throw new Error("attachment not found");
      const stored = await store.readImage(id);
      const width = Number(target?.width);
      const height = Number(target?.height);
      const maxBytes = Number(target?.maxBytes);
      const projected = await store.readImageRequest(stored.ref, {
        maxPixels:
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          width > 0 &&
          height > 0
            ? Math.trunc(width * height)
            : 640_000,
        maxBytes:
          Number.isFinite(maxBytes) && maxBytes > 0
            ? Math.trunc(maxBytes)
            : 2 * 1024 * 1024,
      });
      return {
        data: projected.data,
        mediaType: projected.mediaType,
        attachment: { mediaType: projected.attachment.mediaType },
      };
    },
  };
}
