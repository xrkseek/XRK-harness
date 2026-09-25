import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import { ImageLightbox } from './ImageLightbox.tsx'
import type { ImageLightboxLabels } from './ImageLightbox.tsx'
import css from './MessageImage.module.css'

/** Loads a session-authorized durable image URL and may expose a cached URL synchronously. */
export type ImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined
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
  /** Lightbox strings forwarded to the opened preview. */
  lightbox: ImageLightboxLabels
}

/** Display box for a lone image (DeepSeek Chat rule): long edge 240px with
 * the rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(
  dimensions: { readonly width: number; readonly height: number },
): { width: number; height: number; objectPosition: string } {
  const natural = dimensions.width / dimensions.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
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
 * @param props.image - the durable reference to load, or the local preview to display.
 * @param props.load - session-authorized URL loader for the durable arm.
 * @param props.variant - `single` for a message's lone image, `tile` otherwise.
 * @param props.labels - resolved strings (tooltip, loading, retry, lightbox).
 * @returns the bounded thumbnail button, or the retry control on failure.
 */
export function MessageImage({ image, load, variant, labels }: {
  image: MessageImageSpec
  load: ImageLoader
  variant: 'single' | 'tile'
  labels: MessageImageLabels
}) {
  const preview = 'preview' in image ? image.preview : undefined
  const attachment = 'attachment' in image ? image.attachment : undefined
  const [loaded, setLoaded] = useState<string | null>(() =>
    attachment === undefined ? null : (load.peek?.(attachment) ?? null))
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /** Local echo arm: intrinsic size discovered from the loaded raster (intake probe miss fallback). */
  const [natural, setNatural] = useState<{ readonly width: number; readonly height: number } | null>(null)
  const request = useCallback(() => { setAttempt(a => a + 1) }, [])
  const close = useCallback(() => { setOpen(false) }, [])
  const dimensions = useMemo(() => dimensionsOf(image), [image])
  // Promote the probe-resolved raster size into the single-image fit as soon
  // as it is known (preview arm; the durable arm carries exact dimensions).
  // `?? undefined` pins the null initial state to the undefined sentinel so
  // the fit stays unset until a real size arrives.
  const fitSource = dimensions ?? natural ?? undefined
  const fit = useMemo(
    () => variant === 'single' && fitSource !== undefined ? singleFit(fitSource) : undefined,
    [fitSource, variant],
  )

  useEffect(() => {
    if (attachment === undefined) return
    let live = true
    setError(false)
    setLoaded(load.peek?.(attachment) ?? null)
    void load(attachment).then((url) => { if (live) setLoaded(url) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [attachment, load, attempt])

  const src = preview?.url ?? loaded
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
      ? { width: 240, height: 240 }
      : undefined
  const promote = useCallback((width: number, height: number) => {
    setNatural(current => (current?.width === width && current?.height === height ? current : { width, height }))
  }, [])
  if (error) return <button type="button" className={css.error} data-variant={variant} onClick={request}>{labels.loadFailed}</button>
  return (
    <>
      <button
        type="button"
        className={css.frame}
        data-variant={variant}
        style={frameStyle}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={() => { if (src !== null) setOpen(true) }}
      >
        {src === null
          ? <span className={css.loading}>{labels.loading}</span>
          : previewUnknown
            ? <PreviewFallback
              src={src}
              alt={label}
              onPromote={promote}
            />
            : <img src={src} alt={label} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />}
      </button>
      {open && src !== null && <ImageLightbox src={src} alt={label} labels={labels.lightbox} onClose={close} />}
    </>
  )
}

/** Wrapping image group shared by user and assistant history: a lone image
 * renders large unless its owner requests compact tiles; several always tile. */
export function ImageGallery({ images, load, align, compact = false, labels }: {
  images: readonly MessageImageSpec[]
  load: ImageLoader
  align: 'start' | 'end'
  compact?: boolean
  labels: MessageImageLabels
}) {
  if (images.length === 0) return null
  const variant = compact || images.length > 1 ? 'tile' : 'single'
  return (
    <div className={css.gallery} data-align={align}>
      {images.map((image, index) => (
        <MessageImage
          key={`${'attachment' in image ? image.attachment.attachmentId : image.preview.url}:${index}`}
          image={image}
          load={load}
          variant={variant}
          labels={labels}
        />
      ))}
    </div>
  )
}
