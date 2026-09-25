// image_generate toolview: gallery via tool.call.images when attachmentId= is present.

import type { Context } from '@xrkseek/cordis'
import { IconBrowseOutline16 } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { imageGenCardModel } from '../models/image-gen-card-model.ts'
import { truncateGenSummary } from '../models/video-gen-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type ImageGenRowProps = ToolCallViewProps
  & PropsRenderSlots<'tool.call.images'>
  & PropsLocale<'conversation'>

function promptSummary(argsRaw: string): string | undefined {
  try {
    const args = JSON.parse(argsRaw) as Record<string, unknown>
    if (typeof args.prompt === 'string' && args.prompt.trim() !== '') {
      return truncateGenSummary(args.prompt)
    }
  } catch {
    /* mid-stream */
  }
  return undefined
}

/** image_generate row: Image generation chrome + gallery when attachments exist. */
export function ImageGenRow({
  toolName, block, cwd, home, openFile, inspect, loadImage, renderSlot, t,
}: ImageGenRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const image = imageGenCardModel(block)
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  const prompt = promptSummary(argsRaw)
  const summary = model.state === 'error' && model.errorSummary
    ? model.errorSummary
    : (prompt ?? model.summary)
  return (
    <ToolRow
      t={t}
      variant="others"
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title="Image generation"
      summary={summary}
      body={null}
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

/** The image_generate row as a plain registrant plugin. */
export const imageGenToolview = {
  name: 'image-gen-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'image_generate',
        locale: NS,
        children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
      }, ImageGenRow))
  },
}
