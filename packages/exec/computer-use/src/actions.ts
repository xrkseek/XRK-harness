/**
 * Model-facing `computer_use` action vocabulary.
 * Maps onto agent-desktop CLI commands (plus capture/find envelopes).
 */

export type ComputerUseAction =
  // Observe / inventory
  | "capture"
  | "find"
  | "get"
  | "is"
  | "screenshot"
  | "list_windows"
  | "list_apps"
  | "list_displays"
  | "list_surfaces"
  | "list_notifications"
  | "status"
  | "permissions"
  // Act on a ref / keyboard / mouse
  | "click"
  | "double_click"
  | "triple_click"
  | "right_click"
  | "type"
  | "set_value"
  | "clear"
  | "focus"
  | "select"
  | "toggle"
  | "check"
  | "uncheck"
  | "expand"
  | "collapse"
  | "scroll"
  | "scroll_to"
  | "key"
  | "hover"
  | "drag"
  | "mouse_move"
  | "mouse_wheel"
  | "clipboard_set"
  | "clipboard_get"
  | "clipboard_clear"
  // Apps / windows
  | "launch"
  | "close_app"
  | "focus_window"
  | "resize_window"
  | "move_window"
  | "minimize"
  | "maximize"
  | "restore"
  | "open_system_surface"
  // Notifications
  | "dismiss_notification"
  | "dismiss_all_notifications"
  | "notification_action"
  // Wait / presentation
  | "wait"
  | "overlay";

export const COMPUTER_USE_ACTIONS: readonly ComputerUseAction[] = [
  "capture",
  "find",
  "get",
  "is",
  "screenshot",
  "list_windows",
  "list_apps",
  "list_displays",
  "list_surfaces",
  "list_notifications",
  "status",
  "permissions",
  "click",
  "double_click",
  "triple_click",
  "right_click",
  "type",
  "set_value",
  "clear",
  "focus",
  "select",
  "toggle",
  "check",
  "uncheck",
  "expand",
  "collapse",
  "scroll",
  "scroll_to",
  "key",
  "hover",
  "drag",
  "mouse_move",
  "mouse_wheel",
  "clipboard_set",
  "clipboard_get",
  "clipboard_clear",
  "launch",
  "close_app",
  "focus_window",
  "resize_window",
  "move_window",
  "minimize",
  "maximize",
  "restore",
  "open_system_surface",
  "dismiss_notification",
  "dismiss_all_notifications",
  "notification_action",
  "wait",
  "overlay",
];

/** Actions that only read desktop state (safe for concurrent tool runs). */
export const COMPUTER_USE_READ_ACTIONS: ReadonlySet<string> = new Set([
  "capture",
  "find",
  "get",
  "is",
  "screenshot",
  "list_windows",
  "list_apps",
  "list_displays",
  "list_surfaces",
  "list_notifications",
  "status",
  "permissions",
  "clipboard_get",
]);

const WAIT_EVENTS = new Set([
  "window-opened",
  "window-closed",
  "app-launched",
  "app-terminated",
  "focus-changed",
  "surface-appeared",
  "surface-dismissed",
]);

export function isAgentDesktopWaitEvent(raw: string): boolean {
  return WAIT_EVENTS.has(raw.trim().toLowerCase());
}
