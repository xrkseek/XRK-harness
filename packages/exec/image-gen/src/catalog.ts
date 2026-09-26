/**
 * Hermes-scale FAL image model catalog (tools/image_generation_catalog.py FAL_MODELS).
 * Settings `model` selects an endpoint id; edit uses paired `/edit` when present.
 */

export interface FalImageModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly editEndpoint?: string;
  readonly maxReferenceImages: number;
  readonly note?: string;
}

export const FAL_IMAGE_DEFAULT_MODEL = "fal-ai/flux-2/klein/9b";

/** Main-path FAL image endpoints (Hermes catalog; edit when listed). */
export const FAL_IMAGE_MODELS: readonly FalImageModelEntry[] = [
  {
    id: "fal-ai/flux-2/klein/9b",
    displayName: "FLUX.2 Klein 9B",
    editEndpoint: "fal-ai/flux-2/klein/9b/edit",
    maxReferenceImages: 9,
    note: "Default fast FLUX edit path.",
  },
  {
    id: "fal-ai/flux-2-pro",
    displayName: "FLUX.2 Pro",
    editEndpoint: "fal-ai/flux-2-pro/edit",
    maxReferenceImages: 9,
  },
  {
    id: "fal-ai/z-image/turbo",
    displayName: "Z-Image Turbo",
    maxReferenceImages: 0,
  },
  {
    id: "fal-ai/nano-banana-pro",
    displayName: "Nano Banana Pro",
    editEndpoint: "fal-ai/nano-banana-pro/edit",
    maxReferenceImages: 9,
  },
  {
    id: "fal-ai/nano-banana-2",
    displayName: "Nano Banana 2",
    editEndpoint: "fal-ai/nano-banana-2/edit",
    maxReferenceImages: 9,
  },
  {
    id: "fal-ai/gpt-image-1.5",
    displayName: "GPT Image 1.5",
    editEndpoint: "fal-ai/gpt-image-1.5/edit",
    maxReferenceImages: 16,
  },
  {
    id: "fal-ai/gpt-image-2",
    displayName: "GPT Image 2",
    editEndpoint: "openai/gpt-image-2/edit",
    maxReferenceImages: 16,
  },
  {
    id: "fal-ai/ideogram/v3",
    displayName: "Ideogram V3",
    editEndpoint: "fal-ai/ideogram/v3/edit",
    maxReferenceImages: 1,
  },
  {
    id: "fal-ai/recraft/v4/pro/text-to-image",
    displayName: "Recraft V4 Pro",
    maxReferenceImages: 0,
  },
  {
    id: "fal-ai/qwen-image",
    displayName: "Qwen Image",
    editEndpoint: "fal-ai/qwen-image-2/pro/edit",
    maxReferenceImages: 4,
  },
  {
    id: "fal-ai/krea/v2/medium/text-to-image",
    displayName: "Krea V2 Medium (via FAL)",
    maxReferenceImages: 0,
  },
  {
    id: "fal-ai/krea/v2/large/text-to-image",
    displayName: "Krea V2 Large (via FAL)",
    maxReferenceImages: 0,
  },
  {
    id: "bytedance/seedream/v5/pro/text-to-image",
    displayName: "Seedream V5 Pro",
    editEndpoint: "bytedance/seedream/v5/pro/edit",
    maxReferenceImages: 4,
  },
  {
    id: "bytedance/seedream/v5/lite/text-to-image",
    displayName: "Seedream V5 Lite",
    maxReferenceImages: 0,
  },
  {
    id: "ideogram/v4/instant",
    displayName: "Ideogram V4 Instant",
    maxReferenceImages: 0,
  },
  {
    id: "ideogram/v4/fast",
    displayName: "Ideogram V4 Fast",
    maxReferenceImages: 0,
  },
  {
    id: "alibaba/qwen-image-3/text-to-image",
    displayName: "Qwen Image 3",
    editEndpoint: "alibaba/qwen-image-3/edit",
    maxReferenceImages: 4,
  },
  {
    id: "microsoft/mai-image-2.5-pro",
    displayName: "MAI Image 2.5 Pro",
    maxReferenceImages: 0,
  },
  {
    id: "google/nano-banana-2-lite",
    displayName: "Nano Banana 2 Lite",
    editEndpoint: "google/nano-banana-2-lite/edit",
    maxReferenceImages: 14,
  },
  {
    id: "fal-ai/recraft/v4.1/text-to-image",
    displayName: "Recraft V4.1",
    maxReferenceImages: 0,
  },
  {
    id: "xai/grok-imagine-image/v2.0/text-to-image",
    displayName: "Grok Imagine Image v2",
    editEndpoint: "xai/grok-imagine-image/v2.0/edit",
    maxReferenceImages: 3,
  },
  {
    id: "fal-ai/kling-image/v3/text-to-image",
    displayName: "Kling Image V3",
    editEndpoint: "fal-ai/kling-image/v3/image-to-image",
    maxReferenceImages: 1,
  },
  {
    id: "meta/muse-image/text-to-image",
    displayName: "Meta Muse Image",
    editEndpoint: "meta/muse-image/edit",
    maxReferenceImages: 4,
  },
];

export function resolveFalImageModel(
  model: string | undefined,
): FalImageModelEntry {
  const raw = (model ?? "").trim() || FAL_IMAGE_DEFAULT_MODEL;
  const hit = FAL_IMAGE_MODELS.find((m) => m.id === raw);
  if (hit) return hit;
  return {
    id: raw,
    displayName: raw,
    editEndpoint: `${raw.replace(/\/+$/u, "")}/edit`,
    maxReferenceImages: 9,
    note: "Custom FAL endpoint (edit defaults to `${id}/edit`).",
  };
}
