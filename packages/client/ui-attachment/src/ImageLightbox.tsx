import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular, IconDownloadOutlineRegular } from '@xrkseek/client-ui-primitives'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
  /** Accessible label of the download control. */
  download: string
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Real focus stops inside the dialog. The selector alone over-matches: icon
 * children (`<use href="#…">` inside a button's SVG) carry `href` but are not
 * tab stops, and counting them would leave the last button off the wrap point
 * — Tab would then fall through to the page behind the modal.
 */
function focusStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.tabIndex >= 0)
}

/**
 * Trigger a browser download from a blob/object URL (or data: URL).
 * Mobile Safari often ignores `download` on plain remote hrefs — blob works.
 */
function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Download an image on any browser: prefer fetch→blob (same-origin attachment
 * URLs and CORS-open remotes), fall back to a direct `download` anchor.
 */
async function downloadImage(src: string, filename: string): Promise<void> {
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    triggerDownload(src, filename)
    return
  }
  try {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`download HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      triggerDownload(objectUrl, filename)
    } finally {
      // Revoke after the click has been processed (mobile needs a beat).
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    }
  } catch {
    triggerDownload(src, filename)
  }
}

/** Derive a safe download basename from the image alt text. */
function downloadName(alt: string): string {
  const trimmed = alt.trim()
  if (trimmed.length === 0) return 'image.png'
  if (/\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(trimmed)) return trimmed
  return `${trimmed}.png`
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control; traps Tab within
 * its controls; offers a download action; restores focus to the opener on
 * unmount. Rendered through a body portal: an opener inside a transformed or
 * filtered ancestor would otherwise trap the fixed backdrop in that ancestor's
 * box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog, close, and download strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = rootRef.current
      if (root === null) return
      const nodes = focusStops(root)
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || active === null || !root.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || active === null || !root.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
    }
  }, [onClose])

  const onDownload = (): void => {
    if (saving) return
    setSaving(true)
    void downloadImage(src, downloadName(alt)).finally(() => setSaving(false))
  }

  return createPortal(
    <div
      ref={rootRef}
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
      <img className={css.image} src={src} alt={alt} />
      <div className={css.actions}>
        <button
          type="button"
          className={css.action}
          aria-label={labels.download}
          disabled={saving}
          onClick={onDownload}
        >
          <IconDownloadOutlineRegular size={16} />
        </button>
        <button ref={closeRef} type="button" className={css.action} aria-label={labels.close} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
