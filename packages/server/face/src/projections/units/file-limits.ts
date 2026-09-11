import type { FileAttachmentLimits } from "@xrkseek/attachment";
import type { ProjectionDefinition } from "../registry.js";

/**
 * Face `fileLimits` constant projection (mirrors imageLimits).
 *
 * Boot-constant: `apply` keeps the same state reference so no
 * `session/projection` change frames are ever pushed. Baselines alone
 * (history tail / list) carry the value for InputBar intake pre-check.
 * Register only while an AttachmentStore is composed.
 */
export function createFileLimitsProjectionUnit(
  limits: FileAttachmentLimits,
): ProjectionDefinition<"fileLimits", null, FileAttachmentLimits> {
  return {
    key: "fileLimits",
    stateVersion: 1,
    init: () => null,
    apply: (state) => state,
    wire: {
      view: () => limits,
      parse(value: unknown): FileAttachmentLimits {
        if (!value || typeof value !== "object") {
          throw new Error("fileLimits projection must be an object");
        }
        const v = value as Record<string, unknown>;
        if (
          typeof v.maxFileBytes !== "number" ||
          !Number.isFinite(v.maxFileBytes) ||
          v.maxFileBytes <= 0 ||
          typeof v.maxFilesPerMessage !== "number" ||
          !Number.isFinite(v.maxFilesPerMessage) ||
          v.maxFilesPerMessage <= 0 ||
          typeof v.maxMessageFileBytes !== "number" ||
          !Number.isFinite(v.maxMessageFileBytes) ||
          v.maxMessageFileBytes <= 0
        ) {
          throw new Error("fileLimits projection shape invalid");
        }
        return {
          maxFileBytes: v.maxFileBytes,
          maxFilesPerMessage: v.maxFilesPerMessage,
          maxMessageFileBytes: v.maxMessageFileBytes,
        };
      },
    },
  };
}
