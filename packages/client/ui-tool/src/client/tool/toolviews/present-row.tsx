// Present toolview: keyed hole for `present`. Same ToolRow chrome as other
// write-family rows, plus a showing/shown status suffix. When the result
// carries images, the expanded body is path stack → gallery (paths never sit
// beside / under a covering bitmap). Rows stay force-expanded and outside
// the chat process fold.

import type { MouseEvent, KeyboardEvent } from 'react'
import type { Context } from '@xrkseek/cordis'
import { IconBrowseOutlineRegular } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { imageCardModel, type ImageCardModel } from '../models/image-card-model.ts'
import { toolRowModel, type ToolFileLink } from '../models/tool-call-model.ts'
import { localizeToolTitle } from '../models/localize-tool-title.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './present-row.module.css'

/** Full row props: runtime share, declared image child slot, locale seat. */
type PresentRowProps = ToolCallViewProps
  & PropsRenderSlots<'tool.call.images'>
  & PropsLocale<'conversation'>

/** Status beside the title; failure/stop keep ToolRow's own suffix. */
function presentSuffix(
  state: ReturnType<typeof toolRowModel>['state'],
  t: PresentRowProps['t'],
): string | null {
  if (state === 'running') return t('present.delivering')
  if (state === 'ok') return t('present.delivered')
  return null
}

/** Resolve every deliverable path for the body list (single or multi). */
function deliverableLinks(model: ReturnType<typeof toolRowModel>): readonly ToolFileLink[] {
  if (model.fileLinks !== undefined && model.fileLinks.length > 0) return model.fileLinks
  if (model.filePath !== undefined && model.filePath !== '') {
    return [{ path: model.filePath, label: model.summary || model.filePath }]
  }
  return []
}

const PRESENT_IMAGE_MAX_EDGE = 240

/**
 * Path column + optional gallery. Paths always come first so a tall image
 * cannot cover or collapse the address list on a narrow phone column.
 */
function PresentDeliverableBody({
  links,
  image,
  onOpenFile,
  renderSlot,
  loadImage,
}: {
  links: readonly ToolFileLink[]
  image: ImageCardModel
  onOpenFile: PresentRowProps['openFile']
  renderSlot: PresentRowProps['renderSlot'] | PresentRowProps['mediaRenderSlot']
  loadImage: PresentRowProps['loadImage']
}) {
  const openPath = (path: string) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenFile?.(path)
  }
  const keyOpen = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  }
  const tiles = image.images.map((entry) => ({ attachment: entry.attachment }))
  return (
    <div className={css.deliverable} data-present-deliverable>
      {links.length > 0 ? (
        <div className={css.paths} role="list">
          {links.map((link, i) => (
            <button
              key={`${link.path}\0${String(i)}`}
              type="button"
              role="listitem"
              className={css.path}
              onClick={openPath(link.path)}
              onKeyDown={keyOpen}
            >
              {link.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={css.gallery} data-tool-media="image">
        {renderSlot !== undefined && loadImage !== undefined
          ? renderSlot('tool.call.images', {
              images: tiles,
              loadImage,
              align: 'start',
              maxEdge: PRESENT_IMAGE_MAX_EDGE,
            })
          : (
            <div role="status">
              {tiles.map((entry) => entry.attachment.name ?? entry.attachment.attachmentId).join(' · ')}
            </div>
          )}
      </div>
    </div>
  )
}

/**
 * Present row: title + showing/shown. Always expanded.
 * With images: body = full paths then gallery (same slot as read_image).
 * Without images: header path links (multi-line when force-expanded).
 */
export function PresentRow({
  toolName, block, cwd, home, openFile, inspect, loadImage, renderSlot, mediaRenderSlot, t,
}: PresentRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const image = imageCardModel(block, cwd, home)
  const mediaSlot = mediaRenderSlot ?? renderSlot
  const links = deliverableLinks(model)
  const hasImage = image !== null
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconBrowseOutlineRegular size={14} />}
      title={localizeToolTitle(toolName, model.variant, model.title, t)}
      // Image body owns the path list; keep header to title + status only.
      summary={hasImage ? '' : model.summary}
      summarySuffix={presentSuffix(model.state, t)}
      body={hasImage ? null : model.body}
      bodyContent={hasImage
        ? (
          <PresentDeliverableBody
            links={links}
            image={image}
            onOpenFile={openFile}
            renderSlot={mediaSlot}
            loadImage={loadImage}
          />
        )
        : null}
      output={hasImage ? null : model.output}
      errorSummary={model.errorSummary}
      state={model.state}
      filePath={hasImage ? undefined : model.filePath}
      fileLinks={hasImage ? undefined : model.fileLinks}
      onOpenFile={openFile}
      inspect={inspect}
      forceExpanded
    />
  )
}

/** Present row registrant: keyed toolview under `present`. */
export const presentToolview = {
  name: 'present-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'present', locale: NS }, PresentRow))
  },
}
