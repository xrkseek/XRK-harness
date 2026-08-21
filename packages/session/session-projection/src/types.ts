/**
 * Merge-extensible projection type tables.
 * Client carriers / stubs declare-merge {@link SessionProjectionMap}.
 * Host fold packages declare-merge {@link SessionProjectionStateMap}.
 *
 * @module @xrkseek/session-projection/types
 */

/**
 * Client-visible whole values (wire JSON). Rendering belongs to the slot /
 * UI layer, never this seam.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge table
export interface SessionProjectionMap {}

/**
 * Host fold states. Every client-visible key also appears here; host-only
 * keys appear only here. Values must be plain JSON if a cache is attached.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge table
export interface SessionProjectionStateMap {}
