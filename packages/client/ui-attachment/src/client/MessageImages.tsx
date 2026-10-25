import type { MessageImagesProps } from '@xrkseek/client-ui-conversation/client'
import { ImageGallery } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'

/** Historical message-image slot entry (also fills `tool.call.images`). */
export function MessageImages({
  images, loadImage, align, compact = false, maxEdge, t,
}: MessageImagesProps) {
  return (
    <ImageGallery
      images={images}
      load={loadImage}
      align={align}
      compact={compact}
      maxEdge={maxEdge}
      labels={messageImageLabels(t)}
    />
  )
}
