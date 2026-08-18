export type PtySandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface SandboxModeFenceCheck {
  readonly currentMode: PtySandboxMode;
  readonly nextMode: PtySandboxMode;
  readonly hasPtyActivity: boolean;
}

/**
 * DSH terminal-bash sandbox fence message — reject mode changes while any PTY
 * is open or being created (composition-scoped `hasActivity` in XRK).
 */
export function sandboxModeChangeBlockedMessage(
  check: SandboxModeFenceCheck,
): string | undefined {
  if (check.nextMode === check.currentMode || !check.hasPtyActivity) {
    return undefined;
  }
  return `cannot change sandbox mode from "${check.currentMode}" to "${check.nextMode}" while persistent terminal sessions are open or being created; wait for creation to settle and close them first`;
}
