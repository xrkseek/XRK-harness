import type { ImageAttachmentLimits } from "@xrkseek/attachment";
import type { ProjectionDefinition } from "../registry.js";

/**
 * DSH `imageLimits` constant projection (api-proxy pattern).
 *
 * Boot-constant: `apply` keeps the same state reference so no
 * `session/projection` change frames are ever pushed. Baselines alone
 * (history tail / list) carry the value for InputBar intake pre-check.
 * Register only while an AttachmentStore is composed — absent key =
 * attachment service not available (shell hides upload affordances).
 */
export function createImageLimitsProjectionUnit(
  limits: ImageAttachmentLimits,
): ProjectionDefinition<"imageLimits", null, ImageAttachmentLimits> {
  return {
    key: "imageLimits",
    stateVersion: 1,
    init: () => null,
    apply: (state) => state,
    view: () => limits,
    parse(value: unknown): ImageAttachmentLimits {
      if (!value || typeof value !== "object") {
        throw new Error("imageLimits projection must be an object");
      }
      const v = value as Record<string, unknown>;
      if (
        typeof v.maxImageBytes !== "number" ||
        !Number.isFinite(v.maxImageBytes) ||
        v.maxImageBytes <= 0 ||
        typeof v.maxImagesPerMessage !== "number" ||
        !Number.isFinite(v.maxImagesPerMessage) ||
        v.maxImagesPerMessage <= 0 ||
        typeof v.maxMessageImageBytes !== "number" ||
        !Number.isFinite(v.maxMessageImageBytes) ||
        v.maxMessageImageBytes <= 0 ||
        typeof v.maxImagePixels !== "number" ||
        !Number.isFinite(v.maxImagePixels) ||
        v.maxImagePixels <= 0 ||
        !Array.isArray(v.mediaTypes) ||
        !v.mediaTypes.every((t) => typeof t === "string")
      ) {
        throw new Error("imageLimits projection shape invalid");
      }
      return {
        maxImageBytes: v.maxImageBytes,
        maxImagesPerMessage: v.maxImagesPerMessage,
        maxMessageImageBytes: v.maxMessageImageBytes,
        maxImagePixels: v.maxImagePixels,
        mediaTypes: v.mediaTypes as ImageAttachmentLimits["mediaTypes"],
      };
    },
  };
}
