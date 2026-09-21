import type {
  ImageGenRequest,
  ImageGenResult,
  ImageGenService,
} from "./types.js";
import { ImageGenError } from "./types.js";

/** 1×1 PNG (valid for AttachmentStore image sniff). */
export function minimalPngBytes(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

export interface MemoryImageGenOptions {
  readonly note?: string;
}

/**
 * Deterministic in-memory Provider for CI / demos (`XRK_IMAGE_GEN=memory`).
 */
export function createMemoryImageGenProvider(
  options: MemoryImageGenOptions = {},
): ImageGenService {
  return {
    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new ImageGenError("prompt is empty", "IMAGE_GEN_BAD_ARGS");
      }
      const n = Math.min(Math.max(req.n ?? 1, 1), 4);
      const images = Array.from({ length: n }, () => ({
        bytes: minimalPngBytes(),
        mimeType: "image/png" as const,
        revisedPrompt: prompt,
      }));
      return {
        images,
        provider: "memory",
        delivery: "memory",
        note:
          options.note ??
          `memory-image-gen:${prompt.slice(0, 80)} n=${n}`,
      };
    },
  };
}
