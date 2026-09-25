/**
 * `read_image` tool — persist workspace images as attachments (DSH rc.2).
 * Optional Hermes-style `region` crop runs before admission normalize.
 */
import { basename, extname } from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import type { ImageMediaType } from "@xrkseek/protocol";
import {
  AttachmentError,
  parseImageRegion,
  type AttachmentStore,
  type ImageRegion,
} from "@xrkseek/attachment";

const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Minimal FS surface used by `read_image` (avoids circular import with index). */
export interface ReadImageFs {
  stat(userPath: string): Promise<{ readonly isFile: boolean }>;
  readBytes(userPath: string, maxBytes?: number): Promise<Uint8Array>;
}

export interface ImageReadValue {
  readonly path: string;
  readonly image: {
    readonly attachmentId: string;
    readonly mediaType: ImageMediaType;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    readonly name?: string;
    readonly originalDimensions?: {
      readonly width: number;
      readonly height: number;
    };
    /** Present when `region` crop was applied (Hermes vision offset disclosure). */
    readonly cropOffset?: {
      readonly x: number;
      readonly y: number;
    };
  };
}

export function imageMediaTypeForPath(
  filePath: string,
): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()];
}

export function formatImageReadOutput(
  displayPath: string,
  image: ImageReadValue["image"],
): string {
  let scaled = "";
  if (image.originalDimensions !== undefined) {
    const x = (image.originalDimensions.width / image.width).toFixed(2);
    const y = (image.originalDimensions.height / image.height).toFixed(2);
    const advice =
      x === y
        ? `multiply coordinates by ${x}`
        : `multiply x coordinates by ${x} and y coordinates by ${y}`;
    scaled = ` (downscaled from ${image.originalDimensions.width}x${image.originalDimensions.height} px; ${advice} to locate features in the original file)`;
  }
  let cropNote = "";
  if (image.cropOffset !== undefined) {
    cropNote =
      `. Cropped region of the original image starting at offset ` +
      `(${image.cropOffset.x}, ${image.cropOffset.y}); coordinates are relative ` +
      `to that crop origin — add the offset to map back to the full image`;
  }
  return `<path>${displayPath}</path>
<type>image</type>
<content>
${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes${scaled}${cropNote}
</content>`;
}

export interface CreateReadImageToolOptions {
  readonly fs: ReadImageFs;
  readonly attachments: AttachmentStore;
  /** When false, tool refuses before filesystem I/O. */
  readonly routeAllowsImage?: () => boolean;
}

export function createReadImageTool(
  options: CreateReadImageToolOptions,
): ToolDefinition {
  const { fs, attachments, routeAllowsImage } = options;
  return {
    name: "read_image",
    description:
      "Read a PNG/JPEG/WebP/GIF file and return the image as a durable attachment. " +
      "Large images are normalized before the next model request. " +
      "Optional region [x1,y1,x2,y2] crops in original-image pixels before downscaling " +
      "(full-resolution zoom into small text or fine detail).",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Workspace-relative path to the image file.",
        },
        region: {
          type: "array",
          items: { type: "integer" },
          minItems: 4,
          maxItems: 4,
          description:
            "Optional [x1, y1, x2, y2] crop in ORIGINAL-image pixel coordinates, " +
            "applied before any downscaling — the crop keeps full resolution. " +
            "Load the full image first, then re-call with a region to zoom into " +
            "small text or fine detail.",
        },
      },
      required: ["file_path"],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const raw = args as { file_path?: string; region?: unknown };
      const filePath = String(raw.file_path ?? "").trim();
      if (!filePath) {
        return { content: "file_path must be a non-empty string", isError: true };
      }
      let region: ImageRegion | undefined;
      if (raw.region !== undefined && raw.region !== null) {
        const parsed = parseImageRegion(raw.region);
        if ("error" in parsed) {
          return { content: parsed.error, isError: true };
        }
        if (attachments.cropImageRegion === undefined) {
          return {
            content:
              `cannot read "${filePath}": region cropping requires image processing ` +
              `(local attachment store with sharp); retry without the region parameter.`,
            isError: true,
          };
        }
        region = parsed;
      }
      const mediaType = imageMediaTypeForPath(filePath);
      if (mediaType === undefined) {
        return {
          content: `cannot read "${filePath}": read_image only accepts PNG/JPEG/WebP/GIF paths`,
          isError: true,
        };
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        return {
          content: `cannot read "${filePath}": ${mediaType} images are not accepted`,
          isError: true,
        };
      }
      if (routeAllowsImage && !routeAllowsImage()) {
        return {
          content: `cannot read "${filePath}" as an image: current model route does not declare image input`,
          isError: true,
        };
      }
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile) {
          return {
            content: `cannot read "${filePath}": not a regular file`,
            isError: true,
          };
        }
        const byteCap = Math.min(
          attachments.imageLimits.maxImageBytes,
          attachments.imageLimits.maxMessageImageBytes,
        );
        let data = await fs.readBytes(filePath, byteCap);
        let saveMediaType: ImageMediaType = mediaType;
        let cropOffset: { x: number; y: number } | undefined;
        if (region !== undefined) {
          const cropped = await attachments.cropImageRegion!(data, region);
          data = cropped.data;
          saveMediaType = cropped.mediaType;
          cropOffset = { ...cropped.offset };
        }
        const ref = await attachments.saveImage({
          data,
          mediaType: saveMediaType,
          name: basename(filePath),
        });
        const value: ImageReadValue = {
          path: filePath,
          image: {
            attachmentId: ref.attachmentId,
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...(ref.name !== undefined ? { name: ref.name } : {}),
            ...(ref.originalDimensions !== undefined
              ? { originalDimensions: { ...ref.originalDimensions } }
              : {}),
            ...(cropOffset !== undefined ? { cropOffset } : {}),
          },
        };
        // Model + Face wire: text envelope beside a durable image block (DSH).
        // `meta.path` is presentation-only — the attachment lives only in content.
        return {
          content: [
            { type: "text" as const, text: formatImageReadOutput(value.path, value.image) },
            {
              type: "image" as const,
              attachment: {
                attachmentId: value.image.attachmentId,
                mediaType: value.image.mediaType,
                bytes: value.image.bytes,
                width: value.image.width,
                height: value.image.height,
                ...(value.image.name !== undefined ? { name: value.image.name } : {}),
                ...(value.image.originalDimensions !== undefined
                  ? { originalDimensions: { ...value.image.originalDimensions } }
                  : {}),
              },
            },
          ],
          meta: {
            path: value.path,
            ...(cropOffset !== undefined ? { cropOffset } : {}),
          },
        };
      } catch (err) {
        if (err instanceof AttachmentError) {
          return {
            content: `cannot read "${filePath}": ${err.message}`,
            isError: true,
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { content: message, isError: true };
      }
    },
  };
}
