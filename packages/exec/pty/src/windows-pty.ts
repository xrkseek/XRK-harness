/**
 * Windows node-pty spawn flags: prefer ConPTY (hidden) over winpty, which can
 * flash a console window. Harmless no-ops on non-Windows platforms when merged.
 */
export function windowsPtySpawnOptions(): {
  readonly useConpty?: boolean;
  readonly conptyInheritCursor?: boolean;
} {
  if (process.platform !== "win32") return {};
  return {
    useConpty: true,
    // Do not inherit a visible console cursor host window.
    conptyInheritCursor: false,
  };
}
