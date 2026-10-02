/**
 * Shared timing for the header PresenceDock ↔ Overview presence-rail handoff.
 * Keep CSS keyframe durations in sync with these constants
 * (`--xrkh-sidebar-motion-duration` / `--ds-transition-duration-slow` ≈ 380ms).
 */

/** Shell / better-sidebar shared expand-collapse duration (ms). */
export const PRESENCE_SHELL_MOTION_MS = 380

/** Header dock exit (PresenceDock.module.css `presenceDockOut`). */
export const PRESENCE_DOCK_EXIT_MS = PRESENCE_SHELL_MOTION_MS

/** Header dock enter after Overview closes (PresenceDock.module.css `presenceDockIn`). */
export const PRESENCE_DOCK_ENTER_MS = PRESENCE_SHELL_MOTION_MS

/**
 * Delay before mounting the Overview presence rail after Overview opens,
 * so the header dock can finish exiting toward the details column.
 */
export const PRESENCE_RAIL_HANDOFF_MS = PRESENCE_DOCK_EXIT_MS
