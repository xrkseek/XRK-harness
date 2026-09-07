// read_image toolview: keyed hole for the read_image tool. Composes ToolRow
// with the durable image as collapsed-by-default `image` card material, rendered
// through the Tool-owned `tool.call.images` slot. The attachment presentation
// plugin fills that slot; this layer only supplies references + loadImage.

import type { Context } from '@xrkseek/cordis'
import { IconBrowseOutline16 } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { imageCardModel } from '../models/image-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: runtime share, declared image child slot, locale seat. */
type ReadImageRowProps = ToolCallViewProps
  & PropsRenderSlots<'tool.call.images'>
  & PropsLocale<'conversation'>

/**
 * read_image row: Read-family chrome with the image gallery as the card body.
 * Running / refusal / cancelled calls fall back to text body (no image card).
 */
export function ReadImageRow({
  toolName, block, cwd, home, openFile, inspect, loadImage, renderSlot, t,
}: ReadImageRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const image = imageCardModel(block, cwd, home)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title={model.title}
      summary={model.summary}
      body={null}
      // Image card owns the envelope text; avoid JSON.stringified attachment under it.
      output={image === null ? model.output : null}
      errorSummary={model.errorSummary}
      image={image}
      renderSlot={renderSlot}
      loadImage={loadImage}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/** The read_image row as a plain registrant plugin. */
export const readImageToolview = {
  name: 'read-image-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'read_image',
        locale: NS,
        children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
      }, ReadImageRow))
  },
}
