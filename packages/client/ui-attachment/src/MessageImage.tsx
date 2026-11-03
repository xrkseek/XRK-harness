import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import { downscaleImageUrl, MESSAGE_IMAGE_BITMAP_EDGE } from './downscale-image.ts'
import { ImageLightbox } from './ImageLightbox.tsx'
import type { ImageLightboxLabels } from './ImageLightbox.tsx'
import css from './MessageImage.module.css'

/** Loads a session-authorized durable image URL and may expose a cached URL synchronously. */
export type ImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined
}

/** Long-edge cap of a lone preview inside a message bubble (DeepSeek Chat rule). */
export const MESSAGE_IMAGE_MAX_EDGE = 240

/** Frames a gallery mounts at once. A tool result can carry dozens of images,
 * and every mounted frame owns a loader round-trip plus a decoder; the rest
 * stay behind the overflow cell until the reader asks for them. */
export const GALLERY_MOUNT_LIMIT = 12

/** Viewport pre-roll: a picture starts fetching one flick before it is seen. */
const VIEWPORT_MARGIN = '200px'

const noop = (): void => {}

/**
 * One document-wide observer for every message frame. A chat list mounts
 * hundreds of frames, and one observer per frame would be a browser cost with
 * no gain. An element leaves the observer permanently after its first
 * intersection: scrolling back to an already-admitted picture must not
 * re-fetch it.
 */
class FrameViewport {
  private observer: IntersectionObserver | undefined
  private readonly activators = new Map<Element, () => void>()

  observe(element: Element, activate: () => void): () => void {
    if (typeof IntersectionObserver === 'undefined') {
      activate()
      return noop
    }
    this.observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const current = this.activators.get(entry.target)
        /* v8 ignore next -- the observer reports only elements still registered with it. */
        if (current === undefined) continue
        this.activators.delete(entry.target)
        this.observer?.unobserve(entry.target)
        current()
      }
      this.releaseEmptyObserver()
    }, { rootMargin: VIEWPORT_MARGIN })
    this.activators.set(element, activate)
    this.observer.observe(element)
    return () => {
      this.activators.delete(element)
      this.observer?.unobserve(element)
      this.releaseEmptyObserver()
    }
  }

  private releaseEmptyObserver(): void {
    if (this.activators.size > 0) return
    this.observer?.disconnect()
    this.observer = undefined
  }
}

const frameViewport = new FrameViewport()

/**
 * Gate an element's costly work (attachment fetch, raster decode) on it
 * reaching the viewport. The initial state is `true` when
 * `IntersectionObserver` is missing, so browsers without it — and the jsdom
 * lane — keep painting on the first frame instead of waiting for a callback
 * that never comes.
 * @param target - the frame element whose visibility is tracked.
 * @returns whether the element has been at least one flick from the viewport.
 */
function useViewportReached(target: RefObject<Element | null>): boolean {
  const [reached, setReached] = useState(() => typeof IntersectionObserver === 'undefined')
  const activate = useCallback(() => { setReached(true) }, [])
  useEffect(() => {
    if (reached) return
    const element = target.current
    /* v8 ignore next -- React attaches the host ref before running effects. */
    if (element === null) return
    return frameViewport.observe(element, activate)
  }, [activate, reached, target])
  return reached
}

/** Object URL of a shrunk bitmap, tagged with the source it was derived from:
 * a replaced picture must never paint the previous one for a frame. */
interface ShrunkImage {
  readonly source: string
  readonly url: string
}

/** One gallery entry: a durable admitted reference, or a submission echo's local preview. */
export type MessageImageSpec =
  | {
    readonly attachment: ImageAttachmentRef
    /** Presentation-only name for the thumbnail and lightbox; loading uses the original reference. */
    readonly label?: string
  }
  | {
    readonly preview: {
      readonly url: string
      readonly name?: string
      readonly width?: number
      readonly height?: number
    }
  }

/** Message-image strings the owner resolves from its own locale namespace. */
export interface MessageImageLabels {
  /** Fallback display name for an unnamed image. */
  image: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible thumbnail label; receives the image's display name. */
  openNamed: (label: string) => string
  /** Loading placeholder shown until bytes resolve. */
  loading: string
  /** Retry-control label shown when the load fails. */
  loadFailed: string
  /** Overflow cell of a gallery past its mount limit; receives the hidden count.
   * Optional: a caller without copy for it still gets the neutral `+N` cell. */
  more?: (count: number) => string
  /** Lightbox strings forwarded to the opened preview. */
  lightbox: ImageLightboxLabels
}

/** Display box for a lone image (DeepSeek Chat rule): long edge `maxEdge`
 * (240px in a message bubble, larger inside an expanded Tool card) with the
 * rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(
  dimensions: { readonly width: number; readonly height: number },
  maxEdge: number = MESSAGE_IMAGE_MAX_EDGE,
): { width: number; height: number; objectPosition: string } {
  const natural = dimensions.width / dimensions.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1
    ? { width: maxEdge, height: maxEdge / ratio }
    : { width: maxEdge * ratio, height: maxEdge }
  const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/** Intrinsic dimensions of one gallery entry; a preview's stay unknown until its intake probe resolved. */
function dimensionsOf(image: MessageImageSpec): { readonly width: number; readonly height: number } | undefined {
  if ('attachment' in image) return image.attachment
  return image.preview.width !== undefined && image.preview.height !== undefined
    ? { width: image.preview.width, height: image.preview.height }
    : undefined
}

/**
 * Bounded rendering of a preview whose intrinsic size is not (yet) known —
 * the submission echo's first frame, before the detached intake probe
 * resolves. Without a fixed box a `width:100%` image inside an auto-sized
 * grid frame falls back to the raster's natural size and flashes a
 * full-resolution frame. This component pins the frame to the 240px
 * single-image long-edge box with `object-fit: contain` (never upscaled
 * past the natural size), then promotes to the exact `singleFit` geometry
 * once `onLoad` exposes `naturalWidth`/`naturalHeight`.
 */
function PreviewFallback({ src, alt, onPromote }: {
  src: string
  alt: string
  onPromote: (width: number, height: number) => void
}): ReactNode {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={css.previewFallback}
      onLoad={(event) => {
        const image = event.currentTarget
        const width = image.naturalWidth
        const height = image.naturalHeight
        if (width > 0 && height > 0) onPromote(width, height)
      }}
    />
  )
}

/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile. The preview arm displays its
 * local URL directly — no loader round-trip, no failure/retry surface.
 *
 * Nothing is fetched until the frame is one flick from the viewport, and what
 * is painted is a 480px re-encode rather than the original raster: a phone
 * photo decodes to tens of megabytes, and a scrollback full of them is the
 * mobile OOM this component exists to avoid. The lightbox still opens the
 * original bytes.
 *
 * @param props.image - the durable reference to load, or the local preview to display.
 * @param props.load - session-authorized URL loader for the durable arm.
 * @param props.variant - `single` for a message's lone image, `tile` otherwise.
 * @param props.labels - resolved strings (tooltip, loading, retry, lightbox).
 * @param props.maxEdge - long-edge cap of the `single` box; a Tool card passes
 * the larger tool edge so an expanded card shows a real picture.
 * @param props.large - render a `tile` at the expanded Tool-card tile size.
 * @returns the bounded thumbnail button, or the retry control on failure.
 */
export function MessageImage({ image, load, variant, labels, maxEdge, large = false }: {
  image: MessageImageSpec
  load: ImageLoader
  variant: 'single' | 'tile'
  labels: MessageImageLabels
  maxEdge?: number | undefined
  large?: boolean | undefined
}) {
  const preview = 'preview' in image ? image.preview : undefined
  const attachment = 'attachment' in image ? image.attachment : undefined
  const frameRef = useRef<HTMLButtonElement | null>(null)
  // The visibility gate: the durable loader is not called (no readAttachment
  // round-trip, no full-resolution bytes) until the frame is near the viewport.
  const reached = useViewportReached(frameRef)
  const [loaded, setLoaded] = useState<string | null>(() =>
    attachment === undefined ? null : (load.peek?.(attachment) ?? null))
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /** Local echo arm: intrinsic size discovered from the loaded raster (intake probe miss fallback). */
  const [natural, setNatural] = useState<{ readonly width: number; readonly height: number } | null>(null)
  const request = useCallback(() => { setAttempt(a => a + 1) }, [])
  const close = useCallback(() => { setOpen(false) }, [])
  // Owners build the loader inline on every render (the chat node's props are
  // rebuilt each paint), so the identity is not a load trigger: only the
  // attachment and an explicit retry are. Kept in a ref so the effect still
  // calls the current loader.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  const dimensions = useMemo(() => dimensionsOf(image), [image])
  // Protocol width/height are the model-facing raster, often a downscale.
  // Once the loaded bitmap is larger, fit the preview to that bitmap (still
  // capped by singleFit) so a tool expand is not stuck on the thumb size.
  const [decoded, setDecoded] = useState<{ readonly width: number; readonly height: number } | null>(null)
  /** Downscaled bitmap painted in place of the original raster; `null` until
   * the re-encode lands (or forever, on an engine that cannot do it). */
  const [shrunk, setShrunk] = useState<ShrunkImage | null>(null)
  const promoteDecoded = useCallback((width: number, height: number) => {
    if (!(width > 0) || !(height > 0)) return
    setDecoded(current => (
      current?.width === width && current.height === height ? current : { width, height }
    ))
  }, [])
  // Promote the probe-resolved raster size into the single-image fit as soon
  // as it is known (preview arm; the durable arm carries exact dimensions).
  // `?? undefined` pins the null initial state to the undefined sentinel so
  // the fit stays unset until a real size arrives.
  const declared = dimensions ?? natural ?? undefined
  const fitSource = decoded !== null && (
    declared === undefined
    || decoded.width > declared.width
    || decoded.height > declared.height
  ) ? decoded : declared
  const fit = useMemo(
    () => variant === 'single' && fitSource !== undefined ? singleFit(fitSource, maxEdge) : undefined,
    [fitSource, maxEdge, variant],
  )

  useEffect(() => {
    // Offscreen frames issue no attachment request at all; the effect re-runs
    // with `reached` and only then asks the session-authorized loader.
    if (attachment === undefined || !reached) return
    let live = true
    const loader = loadRef.current
    setError(false)
    // A new attachment owns new intrinsic size: never fit it to the previous
    // bitmap's decoded geometry.
    setDecoded(null)
    setLoaded(loader.peek?.(attachment) ?? null)
    void loader(attachment).then((url) => { if (live) setLoaded(url) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [attachment, attempt, reached])

  const src = preview?.url ?? loaded
  // Best-effort re-encode. The effect owns the object URL it creates: a
  // superseded source, a replaced picture, and unmount all revoke it, and a
  // source without a shrunk twin (old engine, cross-origin, encode failure)
  // just keeps painting the original.
  useEffect(() => {
    if (src === null || !reached) return
    let live = true
    let created: string | null = null
    // Never below the 2×-box floor, and never below this frame's own box — an
    // expanded Tool card shows 520px and must not upscale a 480px bitmap.
    const cap = Math.max(MESSAGE_IMAGE_BITMAP_EDGE, maxEdge ?? MESSAGE_IMAGE_MAX_EDGE)
    void downscaleImageUrl(src, cap).then((url) => {
      if (url === undefined) return
      if (!live) {
        URL.revokeObjectURL(url)
        return
      }
      created = url
      setShrunk({ source: src, url })
    }, noop)
    return () => {
      live = false
      if (created === null) return
      URL.revokeObjectURL(created)
      setShrunk((current) => (current !== null && current.url === created ? null : current))
    }
  }, [maxEdge, reached, src])

  // A shrunk bitmap belongs to exactly one source; anything else would paint
  // the previous picture for a frame after a retry or an attachment swap.
  const displaySrc = shrunk !== null && shrunk.source === src ? shrunk.url : src
  const label = ('label' in image ? image.label : undefined)
    ?? preview?.name ?? attachment?.name ?? labels.image
  // The frame style is the single place that must never let the raster's
  // natural size leak: exact geometry when known, otherwise the bounded
  // fallback box (preview arm only — the durable arm waits on its loader
  // and is never dimension-less here).
  const previewUnknown = src !== null && preview !== undefined && fit === undefined
    && variant === 'single'
  const frameStyle = fit !== undefined
    ? { width: fit.width, height: fit.height }
    : previewUnknown
      ? { width: maxEdge ?? MESSAGE_IMAGE_MAX_EDGE, height: maxEdge ?? MESSAGE_IMAGE_MAX_EDGE }
      : undefined
  const promote = useCallback((width: number, height: number) => {
    setNatural(current => (current?.width === width && current?.height === height ? current : { width, height }))
  }, [])
  if (error) return <button type="button" className={css.error} data-variant={variant} onClick={request}>{labels.loadFailed}</button>
  // Offscreen frames keep their geometry but decode nothing: the placeholder
  // occupies the same box, so the list never jumps when the picture arrives.
  const shown = reached ? displaySrc : null
  return (
    <>
      <button
        ref={frameRef}
        type="button"
        className={css.frame}
        data-variant={variant}
        {...(variant === 'tile' && large ? { 'data-large': '' } : {})}
        style={frameStyle}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={(event) => {
          event.stopPropagation()
          if (src !== null) setOpen(true)
        }}
      >
        {shown === null
          ? <span className={css.loading}>{labels.loading}</span>
          : previewUnknown
            ? <PreviewFallback
              src={shown}
              alt={label}
              onPromote={promote}
            />
            : (
              <img
                src={shown}
                alt={label}
                loading="lazy"
                decoding="async"
                style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }}
                onLoad={(event) => {
                  promoteDecoded(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                }}
              />
            )}
      </button>
      {open && src !== null && <ImageLightbox src={src} alt={label} labels={labels.lightbox} onClose={close} />}
    </>
  )
}

/** Wrapping image group shared by user and assistant history: a lone image
 * renders large unless its owner requests compact tiles; several always tile.
 * `maxEdge` raises the lone-image box (and the tile grid) for an expanded Tool
 * card, where the picture is the point rather than a chat attachment echo.
 * Past `GALLERY_MOUNT_LIMIT` entries the rest wait behind one overflow cell:
 * a tool result with forty screenshots must not mount forty frames at once. */
export function ImageGallery({ images, load, align, compact = false, maxEdge, labels }: {
  images: readonly MessageImageSpec[]
  load: ImageLoader
  align: 'start' | 'end'
  compact?: boolean
  maxEdge?: number | undefined
  labels: MessageImageLabels
}) {
  const [expanded, setExpanded] = useState(false)
  if (images.length === 0) return null
  const variant = compact || images.length > 1 ? 'tile' : 'single'
  const large = maxEdge !== undefined && maxEdge > MESSAGE_IMAGE_MAX_EDGE
  const shown = expanded || images.length <= GALLERY_MOUNT_LIMIT
    ? images
    : images.slice(0, GALLERY_MOUNT_LIMIT)
  const hidden = images.length - shown.length
  const more = labels.more?.(hidden) ?? `+${hidden}`
  return (
    <div className={css.gallery} data-align={align}>
      {shown.map((image, index) => (
        <MessageImage
          key={`${'attachment' in image ? image.attachment.attachmentId : image.preview.url}:${index}`}
          image={image}
          load={load}
          variant={variant}
          maxEdge={maxEdge}
          large={large}
          labels={labels}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className={css.more}
          {...(large ? { 'data-large': '' } : {})}
          title={more}
          aria-label={more}
          onClick={() => { setExpanded(true) }}
        >
          {`+${hidden}`}
        </button>
      )}
    </div>
  )
}
