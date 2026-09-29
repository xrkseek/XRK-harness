/** Tool-call file / video card slot entry (same cards as message file gallery). */
import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import { MessageFileGallery } from '../MessageFileCard.tsx'

/** Owner shape matches `tool.call.files` slot. */
export function ToolFiles({ files, align }: {
  files: readonly { readonly attachment: FileAttachmentRef }[]
  align: 'start' | 'end'
}) {
  return <MessageFileGallery files={files} align={align} />
}
