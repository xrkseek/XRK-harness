/**
 * Pure-type outlet for client aggregates: merge-extensible projection tables
 * without dragging the host drive registry.
 *
 * @module @xrkseek/xrk-session-projection/types
 */

/**
 * Client-visible whole values (wire JSON). Domain stubs / packages merge keys
 * here via declaration merging. Rendering belongs to the slot / UI layer.
 */
export interface SessionProjectionMap {}

/**
 * Host fold-state table (declare-merge from host units). Client code should
 * not read this table — carriers only push {@link SessionProjectionMap} values.
 */
export interface SessionProjectionStateMap {}
