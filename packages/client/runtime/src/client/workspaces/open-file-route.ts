import { isAttachmentAddress } from './path.ts'

/** Scenario knobs for chat / Overview file-open (platform + surface aware). */
export interface RouteWorkspaceOpenFileOptions {
  /**
   * When false, skip Host `openPath` (SSH / headless / non-privileged Web).
   * Community workbench wake still runs when provided.
   */
  readonly allowNativeOpen?: boolean
}

/**
 * Open a workspace file: wake community `xrkh-better-sidebar` when present,
 * then optionally `workspaces.openPath` (OS / Host). Attachment ids are not
 * filesystem paths.
 *
 * Shared by chat `openFile` and Overview Changes preview so both tracks hit the
 * same community workbench contract (see docs/sidebar-workbench.md).
 *
 * Scenario rules:
 * - Prefer in-app workbench when the community plugin wakes a tab.
 * - Soft-fail OS open after a successful wake (Termux / missing xdg-open /
 *   remote Host must not undo a working in-app open).
 * - Skip OS open when `allowNativeOpen` is false (SSH, headless, WAN Web).
 */
export async function routeWorkspaceOpenFile(
  resolvedPath: string,
  openWorkspace: (path: string) => Promise<void>,
  wakeCommunity?: (path: string) => boolean | void,
  options?: RouteWorkspaceOpenFileOptions,
): Promise<void> {
  if (isAttachmentAddress(resolvedPath)) return
  const woke = wakeCommunity?.(resolvedPath) === true
  if (options?.allowNativeOpen === false) return
  try {
    await openWorkspace(resolvedPath)
  } catch (err) {
    if (woke) return
    throw err
  }
}
