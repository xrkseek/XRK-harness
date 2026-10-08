/**
 * Durable read-marker facts for the release-notes surface.
 *
 * Only the acknowledgement is durable — the notes themselves are bundle copy
 * (release-notes.ts), never settings and never localStorage. Same
 * namespace+field shape the product welcome notice already uses, so both
 * onboarding surfaces read and write one settings document.
 */

/** Settings namespace holding product-wide GUI onboarding facts. */
export const RELEASE_NOTES_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the newest release-notes version this user has opened. */
export const RELEASE_NOTES_ACK_FIELD = 'releaseNotesReadVersion'