// ToolRow: the single-line tool summary row (figma component set 122:9479) —
// 16px leading slot (state dot / tool icon, chevron on hover or expanded) + title +
// separator dot + FILL-truncated summary, drawn through the shared
// DisclosureRow chrome with the whole row as the expand toggle (click /
// Enter / Space, icon→chevron hover preview). The collapsed row is always
// one line; every row with body, output, or a card material (terminal, diff,
// read, search, web, image, files) is expandable; the summary stays inline while open.
// Media cards (image gallery / file cards) replace IN/OUT when present.
// Expand state is component-local view state.

import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  CodeBlock, DiffBlock, DisclosureRow, IconInspectOutline12, ReadBlock, SearchBlock, StateDot, TerminalBlock, WebBlock,
} from '@xrkseek/client-ui-primitives'
import type { WebBlockProps } from '@xrkseek/client-ui-primitives'
import type { TranslateNS, PropsRenderSlots } from '@xrkseek/client-ui-slots'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import { CHAT_DIFF_MAX_LINES, type DiffCardModel } from '../models/diff-card-model.ts'
import type { FileCardModel } from '../models/file-card-model.ts'
import type { ImageCardModel } from '../models/image-card-model.ts'
import { CHAT_READ_MAX_LINES, type ReadCardModel } from '../models/read-card-model.ts'
import { CHAT_SEARCH_MAX_LINES, type SearchCardModel } from '../models/search-card-model.ts'
import { terminalBlockLabels, type TerminalCardModel } from '../models/terminal-card-model.ts'
import type { ToolRowState, ToolRowVariant } from '../models/tool-call-model.ts'
import css from './ToolRow.module.css'

type MediaRenderSlot = PropsRenderSlots<'tool.call.images' | 'tool.call.files'>['renderSlot']

export interface ToolRowProps {
  /** The render site's conversation locale seat (terminal/code body copy). */
  t: TranslateNS<'conversation'>
  variant: ToolRowVariant
  /** Wire tool name for tool-owned styling layered over the generic variant. */
  toolName?: string | undefined
  /** Leading 16px tool icon, shown while collapsed and not running/failed. */
  icon: ReactNode
  title: string
  summary: string
  summarySuffix?: string | null | undefined
  /** Expanded-body input text; null = no input section. */
  body: string | null
  /** Flattened result text for the expanded Output section; null/absent = no output section. */
  output?: string | null | undefined
  errorSummary?: string | null | undefined
  terminal?: TerminalCardModel | null | undefined
  diff?: DiffCardModel | null | undefined
  read?: ReadCardModel | null | undefined
  /**
   * Image-card material. Rendered through `tool.call.images` when loadImage is
   * available; otherwise label + meta still show (never fall back to IN/OUT).
   */
  image?: ImageCardModel | null | undefined
  /**
   * File / video card material. Rendered through `tool.call.files` when the
   * slot is filled; otherwise a text list of names under the label.
   */
  files?: FileCardModel | null | undefined
  /** Dispatch image/file galleries through tool-owned slots. */
  renderSlot?: MediaRenderSlot | undefined
  loadImage?: ((attachment: ImageAttachmentRef) => Promise<string>) | undefined
  search?: SearchCardModel | null | undefined
  web?: WebBlockProps | null | undefined
  state: ToolRowState
  filePath?: string | undefined
  onOpenFile?: ((path: string) => void) | undefined
  inspect?: (() => void) | undefined
}

function leadingFor(state: ToolRowState, icon: ReactNode): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return icon
  }
}

function stateStatus(state: ToolRowState, t: TranslateNS<'conversation'>): string | null {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/** Compact collapsed-row thumb for the first durable image (Codex/Cursor peek). */
function CollapsedThumb({
  attachment,
  loadImage,
}: {
  attachment: ImageAttachmentRef
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void loadImage(attachment).then(
      (next) => { if (alive) setUrl(next) },
      () => { /* peek is best-effort */ },
    )
    return () => { alive = false }
  }, [attachment, loadImage])
  if (url === null) {
    return <span className={css.thumbPlaceholder} aria-hidden data-tool-thumb="" />
  }
  return (
    <img
      className={css.thumb}
      src={url}
      alt=""
      data-tool-thumb=""
      draggable={false}
    />
  )
}

export function ToolRow({
  t,
  variant,
  toolName,
  icon,
  title,
  summary,
  summarySuffix,
  body,
  output,
  errorSummary,
  terminal,
  diff,
  read,
  image,
  files,
  renderSlot,
  loadImage,
  search,
  web,
  state,
  filePath,
  onOpenFile,
  inspect,
}: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const terminalBody = terminal ?? null
  const diffBody = diff ?? null
  const readBody = read ?? null
  // Image / file cards own the expanded surface whenever material exists —
  // even without loadImage / renderSlot (show label + meta / name list).
  const imageBody = image ?? null
  const filesBody = files ?? null
  const searchBody = search ?? null
  const webBody = web ?? null
  const outputText = output ?? null
  const card = terminalBody ?? diffBody ?? readBody ?? imageBody ?? filesBody ?? searchBody ?? webBody
  const expandable = body !== null || outputText !== null || card !== null
  const open = expanded && expandable
  const status = stateStatus(state, t)
  const failureLine = state === 'error' ? errorSummary ?? null : null
  const summaryText = failureLine ?? summary
  const suffix = failureLine === null ? summarySuffix ?? null : null
  const fileLink = filePath !== undefined && onOpenFile !== undefined && failureLine === null
  const thumbAttachment = !open
    && state === 'ok'
    && imageBody !== null
    && loadImage !== undefined
    ? imageBody.images[0]?.attachment
    : undefined
  const toggleExpand = () => {
    setExpanded(v => !v)
  }
  const openFile = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (filePath !== undefined) onOpenFile?.(filePath)
  }
  const fileLinkKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  }
  const cardBody = variant === 'code' ? null : body
  return (
    <div className={css.root} data-variant={variant} data-tool={toolName} data-state={state}>
      {status !== null && <span className={css.visuallyHidden}>{status}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(state, icon)}
        title={title}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={toggleExpand}
        collapsedContent={(
          (thumbAttachment !== undefined && loadImage !== undefined) || summaryText !== ''
        ) ? (
          <>
            {thumbAttachment !== undefined && loadImage !== undefined
              ? <CollapsedThumb attachment={thumbAttachment} loadImage={loadImage} />
              : null}
            {summaryText !== '' && (
              <>
                <span className={css.sep} aria-hidden />
                {fileLink ? (
                  <button
                    type="button"
                    className={css.fileLink}
                    onClick={openFile}
                    onKeyDown={fileLinkKeyDown}
                  >
                    {summaryText}
                  </button>
                ) : (
                  <span
                    className={clsx(css.summary, failureLine !== null && css.errorSummary)}
                  >
                    {summaryText}
                  </span>
                )}
                {suffix !== null && <span className={css.summarySuffix}>{suffix}</span>}
              </>
            )}
          </>
        ) : false}
      >
        <div className={css.bodyWrap}>
          {terminalBody !== null
            ? (
              <TerminalBlock
                {...terminalBody.card}
                maxLines={Infinity}
                labels={terminalBlockLabels(t)}
                className={css.terminalBody}
              />
            )
            : diffBody !== null
              ? <DiffBlock {...diffBody.card} maxLines={CHAT_DIFF_MAX_LINES} className={css.diffBody} />
              : readBody !== null
                ? <ReadBlock {...readBody} maxLines={CHAT_READ_MAX_LINES} className={css.readBody} />
                : imageBody !== null
                  ? (
                    <div className={css.imageBody} data-tool-media="image">
                      <div className={css.imageLabel}>{imageBody.label}</div>
                      {renderSlot !== undefined && loadImage !== undefined
                        ? renderSlot('tool.call.images', {
                          images: imageBody.images,
                          loadImage,
                          align: 'start',
                        })
                        : (
                          <div className={css.mediaFallback} role="status">
                            {imageBody.images.map((entry) => entry.attachment.name
                              ?? entry.attachment.attachmentId).join(' · ')}
                          </div>
                        )}
                      {imageBody.text !== ''
                        ? <div className={css.imageMeta}>{imageBody.text}</div>
                        : null}
                    </div>
                  )
                  : filesBody !== null
                    ? (
                      <div className={css.imageBody} data-tool-media="file">
                        <div className={css.imageLabel}>{filesBody.label}</div>
                        {renderSlot !== undefined
                          ? renderSlot('tool.call.files', {
                            files: filesBody.files,
                            align: 'start',
                          })
                          : (
                            <div className={css.mediaFallback} role="status">
                              {filesBody.files.map((entry) => entry.attachment.name).join(' · ')}
                            </div>
                          )}
                        {filesBody.text !== ''
                          ? <div className={css.imageMeta}>{filesBody.text}</div>
                          : null}
                      </div>
                    )
                    : searchBody !== null
                      ? (
                        <>
                          <SearchBlock {...searchBody.card} maxLines={CHAT_SEARCH_MAX_LINES} className={css.searchBody} />
                          {searchBody.recovery !== undefined && (
                            <div className={css.searchRecovery}>{searchBody.recovery}</div>
                          )}
                        </>
                      )
                      : webBody !== null
                        ? <WebBlock {...webBody} className={css.webBody} />
                        : (
                          <>
                            {variant === 'code' && body !== null && (
                              <div className={css.bodyScroll}>
                                <CodeBlock code={body} lang="typescript" copyLabel={t('copy')} copiedLabel={t('copied')} className={css.codeBody} />
                              </div>
                            )}
                            {(cardBody !== null || outputText !== null) && (
                              <div className={css.ioCard}>
                                {cardBody !== null && (
                                  <div className={css.ioSection}>
                                    <span className={css.ioLabel}>IN</span>
                                    <span className={css.ioText}>{cardBody}</span>
                                  </div>
                                )}
                                {cardBody !== null && outputText !== null && (
                                  <span className={css.ioDivider} aria-hidden />
                                )}
                                {outputText !== null && (
                                  <div className={css.ioSection}>
                                    <span className={css.ioLabel}>OUT</span>
                                    <span className={css.ioText} data-error={state === 'error' || undefined}>
                                      {outputText}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
          {inspect !== undefined && (
            <button
              type="button"
              className={css.inspectButton}
              onClick={inspect}
            >
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
