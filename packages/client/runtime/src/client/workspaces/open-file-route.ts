import { isAttachmentAddress } from './path.ts'

/**
 * Open a workspace file: wake community `xrkh-better-sidebar` when present,
 * then `workspaces.openPath` (OS / Host). Attachment ids are not filesystem paths.
 *
 * Shared by chat `openFile` and Overview Changes preview so both tracks hit the
 * same community workbench contract (see docs/sidebar-workbench.md).
 */
export async function routeWorkspaceOpenFile(
  resolvedPath: string,
  openWorkspace: (path: string) => Promise<void>,
  wakeCommunity?: (path: string) => void,
): Promise<void> {
  if (isAttachmentAddress(resolvedPath)) return
  wakeCommunity?.(resolvedPath)
  await openWorkspace(resolvedPath)
}
