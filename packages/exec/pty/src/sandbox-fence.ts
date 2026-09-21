export type PtySandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface SandboxModeFenceCheck {
  readonly currentMode: PtySandboxMode;
  readonly nextMode: PtySandboxMode;
  /**
   * Agent `terminal_*` PTY registry activity only — never sidebar user
   * terminals (DSH user-terminal permissions: system-user, independent of
   * Agent sandbox mode).
   */
  readonly hasPtyActivity: boolean;
}

/**
 * DSH terminal-bash sandbox fence — reject Agent sandbox mode changes while
 * any Agent PTY tool session is open or being created. Sidebar user terminals
 * are a separate process path and must not participate.
 */
export function sandboxModeChangeBlockedMessage(
  check: SandboxModeFenceCheck,
): string | undefined {
  if (check.nextMode === check.currentMode || !check.hasPtyActivity) {
    return undefined;
  }
  return `cannot change sandbox mode from "${check.currentMode}" to "${check.nextMode}" while Agent terminal_* sessions are open or being created; wait for creation to settle and close them first`;
}
