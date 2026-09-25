import type {
  ImageGenCapabilities,
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
  /** Default: text+image with max 4 refs (CI exercises edit path). */
  readonly capabilities?: ImageGenCapabilities;
}

const DEFAULT_CAPS: ImageGenCapabilities = {
  modalities: ["text", "image"],
  maxReferenceImages: 4,
};

/**
 * Deterministic in-memory Provider for CI / demos (`XRK_IMAGE_GEN=memory`).
 * Accepts reference images (edit) and records them in `note`.
 */
export function createMemoryImageGenProvider(
  options: MemoryImageGenOptions = {},
): ImageGenService {
  const caps = options.capabilities ?? DEFAULT_CAPS;
  return {
    capabilities() {
      return caps;
    },
    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      const prompt = String(req.prompt ?? "").trim();
      if (!prompt) {
        throw new ImageGenError("prompt is empty", "IMAGE_GEN_BAD_ARGS");
      }
      const refs = req.referenceImages ?? [];
      if (refs.length > caps.maxReferenceImages) {
        throw new ImageGenError(
          `at most ${caps.maxReferenceImages} reference image(s)`,
          "IMAGE_GEN_BAD_ARGS",
        );
      }
      const isEdit = refs.length > 0;
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
        modality: isEdit ? "image" : "text",
        note:
          options.note ??
          `memory-image-gen:${isEdit ? "edit" : "t2i"}:${prompt.slice(0, 60)} n=${n} refs=${refs.length}`,
      };
    },
  };
}
