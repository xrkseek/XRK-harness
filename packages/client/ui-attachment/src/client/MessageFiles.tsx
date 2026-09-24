import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import { MessageFileGallery } from '../MessageFileCard.tsx'

/** Historical message-file slot entry (owner shape mirrors MessageFilesOwnerProps). */
export function MessageFiles({ files, align }: {
  files: readonly { readonly attachment: FileAttachmentRef }[]
  align: 'start' | 'end'
}) {
  return <MessageFileGallery files={files} align={align} />
}
