/** Generic Tool call card: variant-aware ToolRow over a frozen call slice. */
import { memo, useMemo, type ReactNode } from 'react'
import {
  IconApiOutlineRegular,
  IconBrowseOutlineRegular,
  IconCodeOutlineRegular,
  IconEditOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
} from '@xrkseek/client-ui-primitives'
import type { WebBlockProps } from '@xrkseek/client-ui-primitives'
import type { ToolCallOwnerProps, ToolTreeProps } from '../../contract/slots.ts'
import { diffCardModel, type DiffCardModel } from '../models/diff-card-model.ts'
import { fileCardModel, videoFileCardModel, type FileCardModel } from '../models/file-card-model.ts'
import { imageCardModel, type ImageCardModel } from '../models/image-card-model.ts'
import { imageGenCardModel } from '../models/image-gen-card-model.ts'
import { readCardModel, type ReadCardModel } from '../models/read-card-model.ts'
import { searchCardModel, type SearchCardModel } from '../models/search-card-model.ts'
import { terminalCardModel, terminalFailed, type TerminalCardModel } from '../models/terminal-card-model.ts'
import { toolRowModel, type ToolCallBlock, type ToolRowVariant } from '../models/tool-call-model.ts'
import { localizeToolTitle } from '../models/localize-tool-title.ts'
import { localizeAutoReviewDenial } from '../models/auto-review-denial.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'

/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
const VARIANT_ICONS: Record<ToolRowVariant, ReactNode> = {
  search: <IconSearchOutlineRegular size={14} />,
  read: <IconBrowseOutlineRegular size={14} />,
  bash: <IconApiOutlineRegular size={14} />,
  write: <IconEditOutlineRegular size={14} />,
  edit: <IconEditOutlineRegular size={14} />,
  code: <IconCodeOutlineRegular size={14} />,
  others: <IconSparkleRegular size={14} />,
}

/** The card material one call can carry, one field per selectable card kind. */
interface ToolCallCards {
  terminal: TerminalCardModel | null
  diff: DiffCardModel | null
  read: ReadCardModel | null
  search: SearchCardModel | null
  web: WebBlockProps | null
  image: ImageCardModel | null
  files: FileCardModel | null
}

/**
 * Dispatch the card builders off the wire render-intent tag.
 *
 * Every builder gates on its own `card` tag before doing any work, so asking all
 * seven for every row asked one question seven times: a settled bash row ran the
 * read / search / web / image / file derivations purely to learn they are null.
 * The tag is the same condition each builder checks first, so selecting on it
 * here is not a second opinion about which card this call has — and an unknown
 * tag (a newer host's value arriving over the wire) still lands on the generic
 * path, which is exactly each builder's own null arm.
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @param cwd - session workspace root (terminal cwd / read label resolution).
 * @param home - host account home (path labels).
 * @returns the selected card material, null for every kind this call is not.
 */
function toolCallCards(block: ToolCallBlock, cwd?: string, home?: string): ToolCallCards {
  const cards: ToolCallCards = {
    terminal: null, diff: null, read: null, search: null, web: null, image: null, files: null,
  }
  const settled = 'kind' in block
  // The wire name the media builders gate on; a truncated window drops the call head.
  const wireName = settled ? block.call?.name : block.name

  if (settled) {
    // Settled: the result view owns every card kind.
    switch (block.resultView?.card) {
      case 'terminal': cards.terminal = terminalCardModel(block, cwd); break
      case 'diff': cards.diff = diffCardModel(block); break
      case 'read': cards.read = readCardModel(block, cwd, home); break
      case 'search': cards.search = searchCardModel(block); break
      case 'web': cards.web = webCardModel(block); break
      // Generic / unknown / absent: the documented generic path.
      default: break
    }
  } else {
    // Running: the call view is the only card source. No call view yet is the
    // streaming shell (`assistant/chunk`), where the diff model still paints a
    // pending write/edit's intended change from parseable args alone.
    const callCard = block.callView?.card
    if (callCard === 'terminal') cards.terminal = terminalCardModel(block, cwd)
    else if (callCard === 'diff' || callCard === undefined) cards.diff = diffCardModel(block)
  }

  // Media is name-gated, not tag-gated: image_generate peeks its i2i reference
  // thumbs while still running, and read_image / file results are content
  // envelopes no card tag describes.
  if (wireName === undefined || wireName === 'image_generate') cards.image = imageGenCardModel(block)
  if (cards.image === null && wireName === 'read_image') cards.image = imageCardModel(block, cwd, home)
  if (settled && !block.isError) {
    cards.files = wireName === undefined || wireName === 'video_generate'
      ? videoFileCardModel(block) ?? fileCardModel(block)
      : fileCardModel(block)
  }
  return cards
}

/** Card props: owner payload + locale; optional tree renderSlot for media galleries. */
export interface GenericToolCardProps extends ToolCallOwnerProps {
  t: ToolTreeProps['t']
  /** Tree-authorized `tool.call.images` / `tool.call.files` when used as keyed-miss fallback. */
  renderSlot?: ToolTreeProps['renderSlot'] | undefined
}

function GenericToolCardView({
  toolName, block, cwd, home, openFile, inspect, loadImage, renderSlot, t,
}: GenericToolCardProps) {
  // Both derivations are pure functions of the frozen slice: rebuild them only
  // when the slice (or a display root) actually changes. A re-render of the
  // surrounding turn — another row settling, a scroll pass, a locale swap that
  // keeps `t` stable — then costs no re-derivation, and the model's lazy body
  // cache survives from render to render.
  const model = useMemo(() => toolRowModel(toolName, block, cwd, home), [toolName, block, cwd, home])
  const cards = useMemo(() => toolCallCards(block, cwd, home), [block, cwd, home])
  const autoReview = model.autoReviewDenial === null
    ? null
    : localizeAutoReviewDenial(model.autoReviewDenial, t)
  const { terminal, diff, read, search, web, image, files } = cards
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  const singleFile = model.filePath !== undefined
  const hasMedia = image !== null || files !== null
  // A card owns the expanded surface (ToolRow renders the card instead of the
  // IN/OUT block) and already makes the row expandable, so a carded row must
  // not even ASK for the body: reading the accessor is what runs the args
  // redaction + `JSON.stringify`. This is the difference between pretty-printing
  // every visible bash/read/grep/edit row and pretty-printing only the generic
  // rows that actually show their arguments.
  const hasCard = terminal !== null || diff !== null || read !== null || search !== null || web !== null
  const body = singleFile || hasMedia || autoReview !== null || hasCard ? null : model.body
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={VARIANT_ICONS[model.variant]}
      title={localizeToolTitle(toolName, model.variant, model.title, t)}
      summary={terminal?.description ?? search?.title ?? model.summary}
      body={body}
      output={autoReview?.output ?? (hasMedia ? null : model.output)}
      errorSummary={autoReview?.summary ?? model.errorSummary}
      terminal={autoReview !== null ? null : terminal}
      diff={autoReview !== null ? null : diff}
      read={autoReview !== null ? null : read}
      search={autoReview !== null ? null : search}
      web={autoReview !== null ? null : web}
      image={autoReview !== null ? null : image}
      files={autoReview !== null ? null : files}
      renderSlot={renderSlot}
      loadImage={loadImage}
      state={state}
      filePath={model.filePath}
      onOpenFile={singleFile ? openFile : undefined}
      inspect={inspect}
    />
  )
}

/**
 * Keyed-miss fallback row. Memoized on its props: the disclosure state lives
 * inside {@link ToolRow}, so an equal slice must render nothing at all here —
 * without this, every parent pass rebuilt the model and re-ran the card
 * dispatch for every visible call.
 */
export const GenericToolCard = memo(GenericToolCardView)
