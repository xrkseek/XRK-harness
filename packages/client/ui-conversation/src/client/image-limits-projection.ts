/**
 * Client-side merge of Face `imageLimits` into SessionProjectionMap.
 *
 * The authoritative declare lives on `@xrkseek/xrk-host-apiproxy` sessions
 * contract; importing that emitted .d.ts does not land the merge for this
 * package's tsc emit. Mirror the key here (same shape) so InputBar's
 * intake pre-check is typed.
 */
import type { ImageAttachmentLimits } from '@xrkseek/xrk-attachment'

declare module '@xrkseek/xrk-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Deployment image-intake limits (constant per host boot). Key absence
     * means no attachment service — clients skip the pre-check.
     */
    imageLimits: ImageAttachmentLimits
  }
}
