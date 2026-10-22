/**
 * Windows node-pty spawn flags: prefer ConPTY (hidden) over winpty, which can
 * flash a console window. `useConptyDll` selects node-pty's bundled OpenConsole
 * instead of the OS conhost — malformed prompt redraws on some Windows builds
 * otherwise break prompt-tail matching and force a full idleSilenceMs wait.
 * Harmless no-ops on non-Windows platforms when merged.
 */
export function windowsPtySpawnOptions(): {
  readonly useConpty?: boolean;
  readonly useConptyDll?: boolean;
  readonly conptyInheritCursor?: boolean;
} {
  if (process.platform !== "win32") return {};
  return {
    useConpty: true,
    useConptyDll: true,
    // Do not inherit a visible console cursor host window.
    conptyInheritCursor: false,
  };
}
