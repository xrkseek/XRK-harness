/**
 * Build model-facing tool parameters from Provider capabilities
 * (Hermes `_build_dynamic_image_schema`).
 */

import {
  imageGenSupportsEdit,
  type ImageGenCapabilities,
  type ImageGenSize,
} from "./types.js";

export const IMAGE_GEN_SIZES: readonly ImageGenSize[] = [
  "256x256",
  "512x512",
  "1024x1024",
  "1792x1024",
  "1024x1792",
];

export interface ImageGenToolParameters {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: readonly string[];
}

/** Static base + edit args only when `capabilities` support image refs. */
export function buildImageGenToolParameters(
  caps: ImageGenCapabilities,
): ImageGenToolParameters {
  const properties: Record<string, unknown> = {
    prompt: {
      type: "string",
      description:
        "Full visual description (text-to-image) or edit instruction (image-to-image).",
    },
    size: {
      type: "string",
      enum: [...IMAGE_GEN_SIZES],
      description: "Output size (provider-dependent; default 1024x1024).",
    },
    n: {
      type: "number",
      description: "Number of images (1–4; dall-e-3 forces 1).",
    },
    model: {
      type: "string",
      description: "Optional model override (e.g. dall-e-3, gpt-image-1).",
    },
  };

  if (imageGenSupportsEdit(caps)) {
    properties.image_url = {
      type: "string",
      description:
        "Primary reference for edit / i2i: prefer attachment:<attachmentId> or https URL. " +
        "Do NOT paste data:image/…;base64,… (truncates the tool call). Use reference_attachment_ids instead.",
    };
    properties.reference_image_urls = {
      type: "array",
      items: { type: "string" },
      description:
        `Additional https / attachment:<id> refs (same rules as image_url; no base64 data URLs). Max ${caps.maxReferenceImages} sources total.`,
    };
    properties.reference_attachment_ids = {
      type: "array",
      items: { type: "string" },
      description:
        "Preferred edit references: Host AttachmentStore image ids from chat attachments or prior image_generate results.",
    };
  }

  return {
    type: "object",
    properties,
    required: ["prompt"],
  };
}

export function buildImageGenToolDescription(caps: ImageGenCapabilities): string {
  if (imageGenSupportsEdit(caps)) {
    return (
      "Generate or edit an image via the Host image Provider. " +
      "Text-only prompt → text-to-image; for edit pass reference_attachment_ids " +
      `(or image_url=attachment:<id> / https; ≤${caps.maxReferenceImages}). ` +
      "Never paste data:image base64 into args (call truncates). " +
      "Result text gives attachmentId=sha256:… — re-inspect with read_image."
    );
  }
  return (
    "Generate an image from a text prompt via the Host text-to-image Provider. " +
    "This Provider does not accept reference images. " +
    "Result text gives attachmentId=sha256:… — re-inspect with read_image."
  );
}
