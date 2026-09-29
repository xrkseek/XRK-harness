/** Generic Tool call card: variant-aware ToolRow over a frozen call slice. */
import type { ReactNode } from 'react'
import {
  IconApiOutline14,
  IconBrowseOutline16,
  IconCodeOutline16,
  IconEditOutline16,
  IconSearchOutline16,
  IconSparkle16,
} from '@xrkseek/client-ui-primitives'
import type { ToolCallOwnerProps, ToolTreeProps } from '../../contract/slots.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { fileCardModel, videoFileCardModel } from '../models/file-card-model.ts'
import { imageCardModel } from '../models/image-card-model.ts'
import { imageGenCardModel } from '../models/image-gen-card-model.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { searchCardModel } from '../models/search-card-model.ts'
import { terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { toolRowModel, type ToolRowVariant } from '../models/tool-call-model.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'

/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
const VARIANT_ICONS: Record<ToolRowVariant, ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  others: <IconSparkle16 size={14} />,
}

/** Card props: owner payload + locale; optional tree renderSlot for media galleries. */
export interface GenericToolCardProps extends ToolCallOwnerProps {
  t: ToolTreeProps['t']
  /** Tree-authorized `tool.call.images` / `tool.call.files` when used as keyed-miss fallback. */
  renderSlot?: ToolTreeProps['renderSlot'] | undefined
}

export function GenericToolCard({
  toolName, block, cwd, home, openFile, inspect, loadImage, renderSlot, t,
}: GenericToolCardProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const terminal = terminalCardModel(block, cwd)
  const read = readCardModel(block, cwd, home)
  const diff = diffCardModel(block)
  const search = searchCardModel(block)
  const web = webCardModel(block)
  // Media even on the keyed-miss fallback: prefer gen cards, then read_image,
  // then generic file ContentBlocks / video envelopes.
  const image = imageGenCardModel(block) ?? imageCardModel(block, cwd, home)
  const files = videoFileCardModel(block) ?? fileCardModel(block)
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  const singleFile = model.filePath !== undefined
  const hasMedia = image !== null || files !== null
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={VARIANT_ICONS[model.variant]}
      title={model.title}
      summary={terminal?.description ?? search?.title ?? model.summary}
      body={singleFile || hasMedia ? null : model.body}
      output={hasMedia ? null : model.output}
      errorSummary={model.errorSummary}
      terminal={terminal}
      diff={diff}
      read={read}
      search={search}
      web={web}
      image={image}
      files={files}
      renderSlot={renderSlot}
      loadImage={loadImage}
      state={state}
      filePath={model.filePath}
      onOpenFile={singleFile ? openFile : undefined}
      inspect={inspect}
    />
  )
}
