import { isAttachmentAddress } from '@xrkseek/client-runtime/src/client/workspaces/path.ts'

/**
 * Chat file-open routing: wake community sidebar when present, then
 * `workspaces.openPath`. Without `xrkh-better-sidebar`, Host opens via OS.
 *
 * Attachment ids (`sha256:…` / `attachment:…`) are not filesystem paths.
 */
export async function routeChatOpenFile(
  resolvedPath: string,
  openWorkspace: (path: string) => Promise<void>,
  wakeCommunity?: (path: string) => void,
): Promise<void> {
  if (isAttachmentAddress(resolvedPath)) return
  wakeCommunity?.(resolvedPath)
  await openWorkspace(resolvedPath)
}
