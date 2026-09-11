/**
 * Client-side merge of Face `fileLimits` into SessionProjectionMap.
 */
import type { FileAttachmentLimits } from '@xrkseek/xrk-attachment'

declare module '@xrkseek/xrk-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Deployment generic-file intake limits (constant per host boot). Key
     * absence means the shell only accepts image MIME types at intake.
     */
    fileLimits: FileAttachmentLimits
  }
}
