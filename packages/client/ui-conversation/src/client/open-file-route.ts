/**
 * Chat file-open routing: first-party workbench panel, else workspaces.openPath
 * (community sidebars usually wrap the latter).
 */
export async function routeChatOpenFile(
  resolvedPath: string,
  workbench: { openPath?(path: string): boolean } | undefined,
  openWorkspace: (path: string) => Promise<void>,
): Promise<void> {
  if (workbench?.openPath?.(resolvedPath) === true) return
  await openWorkspace(resolvedPath)
}
