/**
 * Chat file-open routing: first-party workbench panel, else wake community
 * (when present) and `workspaces.openPath` (community sidebars usually wrap
 * the latter).
 */
export async function routeChatOpenFile(
  resolvedPath: string,
  workbench: { openPath?(path: string): boolean } | undefined,
  openWorkspace: (path: string) => Promise<void>,
  wakeCommunity?: (path: string) => void,
): Promise<void> {
  if (workbench?.openPath?.(resolvedPath) === true) return
  wakeCommunity?.(resolvedPath)
  await openWorkspace(resolvedPath)
}
