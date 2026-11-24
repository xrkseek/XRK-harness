import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCloseOutlineRegular, IconDownloadOutlineRegular, useShellFrameOverlay,
} from '@xrkseek/client-ui-primitives'
import {
  clampPan,
  fitScale,
  fitsInStage,
  initialPanZoom,
  maxScaleFor,
  minScaleFor,
  zoomAround,
  type NaturalSize,
  type PanZoom,
  type StageSize,
} from './image-lightbox-transform.ts'
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

const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_PX = 28
const SWIPE_DISMISS_PX = 110

function focusStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.tabIndex >= 0)
}

function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

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
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    }
  } catch {
    triggerDownload(src, filename)
  }
}

function downloadName(alt: string): string {
  const trimmed = alt.trim()
  if (trimmed.length === 0) return 'image.png'
  if (/\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(trimmed)) return trimmed
  return `${trimmed}.png`
}

function stageSizeOf(el: HTMLElement): StageSize {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
  return {
    width: Math.max(1, rect.width - padX),
    height: Math.max(1, rect.height - padY),
  }
}

function focalFromClient(
  stage: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = stage.getBoundingClientRect()
  const style = getComputedStyle(stage)
  const padL = Number.parseFloat(style.paddingLeft) || 0
  const padT = Number.parseFloat(style.paddingTop) || 0
  const padR = Number.parseFloat(style.paddingRight) || 0
  const padB = Number.parseFloat(style.paddingBottom) || 0
  const innerW = Math.max(1, rect.width - padL - padR)
  const innerH = Math.max(1, rect.height - padT - padB)
  const centerX = rect.left + padL + innerW / 2
  const centerY = rect.top + padT + innerH / 2
  return { x: clientX - centerX, y: clientY - centerY }
}

function hitsImage(
  focalX: number,
  focalY: number,
  view: PanZoom,
  natural: NaturalSize,
): boolean {
  const halfW = (natural.width * view.scale) / 2
  const halfH = (natural.height * view.scale) / 2
  return Math.abs(focalX - view.x) <= halfW && Math.abs(focalY - view.y) <= halfH
}

type PointerMode =
  | {
    kind: 'pan'
    pointerId: number
    lastX: number
    lastY: number
    originY: number
    moved: boolean
    dismissDy: number
  }
  | {
    kind: 'pinch'
    aId: number
    bId: number
    startDist: number
    startScale: number
    focalX: number
    focalY: number
  }

/**
 * Document-level original-image preview: fit-first stage, Ctrl/⌘+wheel & pinch
 * zoom, drag / wheel pan, double-tap toggle. Multi-end: visualViewport, iOS
 * scroll lock, cached-image load, touch double-tap, swipe-down dismiss at fit.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const aliveRef = useRef(true)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<NaturalSize | null>(null)
  const [stage, setStage] = useState<StageSize>({ width: 1, height: 1 })
  const [view, setView] = useState<PanZoom>({ scale: 1, x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [zoomChip, setZoomChip] = useState(false)
  const pointerRef = useRef<PointerMode | null>(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const viewRef = useRef(view)
  const naturalRef = useRef(natural)
  const stageRefSize = useRef(stage)
  const userAdjustedRef = useRef(false)
  const zoomHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastZoomFlash = useRef(0)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const onCloseRef = useRef(onClose)
  viewRef.current = view
  naturalRef.current = natural
  stageRefSize.current = stage
  onCloseRef.current = onClose

  const canPan = natural !== null && !fitsInStage(view, natural, stage)
  const zoomPercent = natural === null ? 100 : Math.max(1, Math.round(view.scale * 100))
  const caption = alt.trim()

  useShellFrameOverlay(rootRef, true)

  const flashZoom = (force = false): void => {
    const now = performance.now()
    if (!force && now - lastZoomFlash.current < 80) {
      if (zoomHideTimer.current !== null) clearTimeout(zoomHideTimer.current)
      zoomHideTimer.current = setTimeout(() => setZoomChip(false), 900)
      return
    }
    lastZoomFlash.current = now
    setZoomChip(true)
    if (zoomHideTimer.current !== null) clearTimeout(zoomHideTimer.current)
    zoomHideTimer.current = setTimeout(() => setZoomChip(false), 900)
  }

  const applyNatural = (width: number, height: number): void => {
    const next: NaturalSize = {
      width: Math.max(1, width),
      height: Math.max(1, height),
    }
    userAdjustedRef.current = false
    setFailed(false)
    setNatural(next)
    const st = stageRef.current !== null ? stageSizeOf(stageRef.current) : stageRefSize.current
    setStage(st)
    setView(initialPanZoom(next, st))
  }

  // Reset framing when the opener swaps the blob/url under the same dialog.
  useLayoutEffect(() => {
    userAdjustedRef.current = false
    setFailed(false)
    setNatural(null)
    setView({ scale: 1, x: 0, y: 0 })
    setZoomChip(false)
    lastTapRef.current = null
    const img = imgRef.current
    if (img !== null && img.complete && img.naturalWidth > 0) {
      applyNatural(img.naturalWidth, img.naturalHeight)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-arm on src
  }, [src])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (el === null) return
    const sync = (): void => {
      const next = stageSizeOf(el)
      setStage((prev) => (
        prev.width === next.width && prev.height === next.height ? prev : next
      ))
    }
    sync()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    window.addEventListener('xrk-keyboard-inset', sync)
    const vv = window.visualViewport
    vv?.addEventListener('resize', sync)
    vv?.addEventListener('scroll', sync)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      window.removeEventListener('xrk-keyboard-inset', sync)
      vv?.removeEventListener('resize', sync)
      vv?.removeEventListener('scroll', sync)
    }
  }, [])

  useLayoutEffect(() => {
    if (natural === null) return
    if (!userAdjustedRef.current) {
      setView(initialPanZoom(natural, stage))
      return
    }
    setView((prev) => {
      const fit = fitScale(natural, stage)
      const scale = Math.min(maxScaleFor(fit), Math.max(minScaleFor(fit), prev.scale))
      const pan = clampPan(prev.x, prev.y, scale, natural, stage)
      return { scale, x: pan.x, y: pan.y }
    })
  }, [natural, stage])

  useEffect(() => {
    aliveRef.current = true
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()

    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPosition = body.style.position
    const previousBodyTop = body.style.top
    const previousBodyWidth = body.style.width
    const scrollY = window.scrollY
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    // iOS Safari: overflow alone still rubber-bands; pin the body for the session.
    const pinBody = /iP(hone|ad|od)/.test(navigator.userAgent)
    if (pinBody) {
      body.style.position = 'fixed'
      body.style.top = `-${scrollY}px`
      body.style.width = '100%'
    }

    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      const nat = naturalRef.current
      const st = stageRefSize.current
      const cur = viewRef.current
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        if (nat === null) return
        userAdjustedRef.current = true
        setView(zoomAround(cur, cur.scale * 1.2, 0, 0, nat, st))
        flashZoom(true)
        return
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        if (nat === null) return
        userAdjustedRef.current = true
        setView(zoomAround(cur, cur.scale / 1.2, 0, 0, nat, st))
        flashZoom(true)
        return
      }
      if (event.key === '0') {
        if (nat === null) return
        userAdjustedRef.current = false
        setView(initialPanZoom(nat, st))
        flashZoom(true)
        return
      }
      if (
        nat !== null
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'
          || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        if (fitsInStage(cur, nat, st)) return
        event.preventDefault()
        const step = event.shiftKey ? 80 : 40
        const dx = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0
        const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0
        const pan = clampPan(cur.x + dx, cur.y + dy, cur.scale, nat, st)
        userAdjustedRef.current = true
        setView({ scale: cur.scale, x: pan.x, y: pan.y })
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

    // Non-passive wheel: React's onWheel is passive in modern browsers, so
    // preventDefault there cannot stop trackpad-page-zoom / overscroll.
    const onWheelNative = (event: WheelEvent): void => {
      event.preventDefault()
      const nat = naturalRef.current
      if (nat === null) return
      const cur = viewRef.current
      const st = stageRefSize.current
      const stageEl = stageRef.current
      if (event.ctrlKey || event.metaKey) {
        const intensity = Math.min(0.35, Math.abs(event.deltaY) / 120)
        const factor = event.deltaY < 0 ? 1 + intensity * 0.45 : 1 / (1 + intensity * 0.45)
        userAdjustedRef.current = true
        if (stageEl !== null) {
          const focal = focalFromClient(stageEl, event.clientX, event.clientY)
          setView(zoomAround(cur, cur.scale * factor, focal.x, focal.y, nat, st))
        } else {
          setView(zoomAround(cur, cur.scale * factor, 0, 0, nat, st))
        }
        flashZoom()
        return
      }
      const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? st.height : 1
      const dx = -(event.deltaX * line)
      const dy = -(event.deltaY * line)
      if (dx === 0 && dy === 0) return
      const pan = clampPan(cur.x + dx, cur.y + dy, cur.scale, nat, st)
      if (pan.x !== cur.x || pan.y !== cur.y) userAdjustedRef.current = true
      setView({ scale: cur.scale, x: pan.x, y: pan.y })
    }

    // Block document rubber-band outside the stage (iOS / Android WebView).
    const onTouchMoveDoc = (event: TouchEvent): void => {
      const stageEl = stageRef.current
      const target = event.target
      if (
        stageEl !== null
        && target instanceof Node
        && stageEl.contains(target)
      ) {
        return
      }
      event.preventDefault()
    }

    const stageEl = stageRef.current
    stageEl?.addEventListener('wheel', onWheelNative, { passive: false })
    document.addEventListener('touchmove', onTouchMoveDoc, { passive: false })
    window.addEventListener('keydown', onKeyDown)

    return () => {
      aliveRef.current = false
      stageEl?.removeEventListener('wheel', onWheelNative)
      document.removeEventListener('touchmove', onTouchMoveDoc)
      window.removeEventListener('keydown', onKeyDown)
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
      if (pinBody) {
        body.style.position = previousBodyPosition
        body.style.top = previousBodyTop
        body.style.width = previousBodyWidth
        window.scrollTo(0, scrollY)
      }
      if (zoomHideTimer.current !== null) clearTimeout(zoomHideTimer.current)
      restoreRef.current?.focus()
    }
  }, [])

  const onImageLoad = (): void => {
    const img = imgRef.current
    if (img === null || img.naturalWidth < 1) return
    applyNatural(img.naturalWidth, img.naturalHeight)
  }

  const onImageError = (): void => {
    setFailed(true)
    setNatural(null)
  }

  const onDownload = (): void => {
    if (saving || failed) return
    setSaving(true)
    void downloadImage(src, downloadName(alt)).finally(() => {
      if (aliveRef.current) setSaving(false)
    })
  }

  const toggleZoomAt = (clientX: number, clientY: number): void => {
    const nat = naturalRef.current
    const stageEl = stageRef.current
    if (nat === null || stageEl === null) return
    const fit = fitScale(nat, stageRefSize.current)
    const cur = viewRef.current
    const nearFit = Math.abs(cur.scale - fit) < 0.05
    if (!nearFit) {
      userAdjustedRef.current = false
      setView(initialPanZoom(nat, stageRefSize.current))
      flashZoom(true)
      return
    }
    const target = Math.min(maxScaleFor(fit), Math.max(fit * 2, minScaleFor(fit) * 2))
    userAdjustedRef.current = true
    const focal = focalFromClient(stageEl, clientX, clientY)
    setView(zoomAround(cur, target, focal.x, focal.y, nat, stageRefSize.current))
    flashZoom(true)
  }

  const endPointers = (): void => {
    pointerRef.current = null
    setPanning(false)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const stageEl = stageRef.current
    if (stageEl === null) return
    stageEl.setPointerCapture?.(event.pointerId)
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...activePointers.current.entries()]
    if (points.length >= 2) {
      const [a, b] = points
      const dx = b![1].x - a![1].x
      const dy = b![1].y - a![1].y
      const dist = Math.hypot(dx, dy) || 1
      const midX = (a![1].x + b![1].x) / 2
      const midY = (a![1].y + b![1].y) / 2
      const focal = focalFromClient(stageEl, midX, midY)
      pointerRef.current = {
        kind: 'pinch',
        aId: a![0],
        bId: b![0],
        startDist: dist,
        startScale: viewRef.current.scale,
        focalX: focal.x,
        focalY: focal.y,
      }
      setPanning(true)
      return
    }
    pointerRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      originY: event.clientY,
      moved: false,
      dismissDy: 0,
    }
    setPanning(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!activePointers.current.has(event.pointerId)) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const mode = pointerRef.current
    const nat = naturalRef.current
    if (mode === null || nat === null) return
    if (mode.kind === 'pinch') {
      const a = activePointers.current.get(mode.aId)
      const b = activePointers.current.get(mode.bId)
      if (a === undefined || b === undefined) return
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nextScale = mode.startScale * (dist / mode.startDist)
      userAdjustedRef.current = true
      setView(zoomAround(
        viewRef.current,
        nextScale,
        mode.focalX,
        mode.focalY,
        nat,
        stageRefSize.current,
      ))
      flashZoom()
      return
    }
    if (mode.pointerId !== event.pointerId) return
    const dx = event.clientX - mode.lastX
    const dy = event.clientY - mode.lastY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mode.moved = true
    mode.lastX = event.clientX
    mode.lastY = event.clientY
    const cur = viewRef.current
    const st = stageRefSize.current
    // At fit: vertical drag is a dismiss gesture (phone / tablet QQ-style).
    if (fitsInStage(cur, nat, st)) {
      mode.dismissDy = event.clientY - mode.originY
      return
    }
    userAdjustedRef.current = true
    const pan = clampPan(cur.x + dx, cur.y + dy, cur.scale, nat, st)
    setView({ scale: cur.scale, x: pan.x, y: pan.y })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const mode = pointerRef.current
    activePointers.current.delete(event.pointerId)
    try {
      stageRef.current?.releasePointerCapture?.(event.pointerId)
    } catch {
      // capture may already be released
    }

    if (mode?.kind === 'pinch') {
      flashZoom(true)
      if (activePointers.current.size === 0) endPointers()
      else if (activePointers.current.size === 1) {
        const [id, point] = [...activePointers.current.entries()][0]!
        pointerRef.current = {
          kind: 'pan',
          pointerId: id,
          lastX: point.x,
          lastY: point.y,
          originY: point.y,
          moved: true,
          dismissDy: 0,
        }
      }
      return
    }

    if (mode?.kind === 'pan' && mode.pointerId === event.pointerId) {
      const nat = naturalRef.current
      const stageEl = stageRef.current
      const cur = viewRef.current
      const st = stageRefSize.current

      if (mode.moved && nat !== null && fitsInStage(cur, nat, st) && mode.dismissDy > SWIPE_DISMISS_PX) {
        onCloseRef.current()
        endPointers()
        return
      }

      if (!mode.moved) {
        const now = performance.now()
        const prev = lastTapRef.current
        const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen'
        if (
          prev !== null
          && now - prev.t <= DOUBLE_TAP_MS
          && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) <= DOUBLE_TAP_PX
        ) {
          lastTapRef.current = null
          toggleZoomAt(event.clientX, event.clientY)
          endPointers()
          return
        }
        lastTapRef.current = { t: now, x: event.clientX, y: event.clientY }

        // Mouse: empty-stage click dismisses (double-click handled separately).
        // Touch: wait briefly for a possible second tap before dismissing.
        if (stageEl !== null && nat !== null) {
          const focal = focalFromClient(stageEl, event.clientX, event.clientY)
          if (!hitsImage(focal.x, focal.y, cur, nat)) {
            if (!isTouch) {
              onCloseRef.current()
            } else {
              const tapSnapshot = lastTapRef.current
              window.setTimeout(() => {
                if (lastTapRef.current !== tapSnapshot) return
                onCloseRef.current()
              }, DOUBLE_TAP_MS)
            }
          }
        } else if (!isTouch) {
          onCloseRef.current()
        }
      }
      endPointers()
      return
    }

    if (activePointers.current.size === 0) endPointers()
  }

  const onDoubleClick = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Touch uses double-tap in pointerup; mouse/trackpad keep native dblclick.
    if (event.pointerType === 'touch') return
    event.preventDefault()
    toggleZoomAt(event.clientX, event.clientY)
  }

  const transform = natural === null
    ? 'translate(-50%, -50%)'
    : `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`

  const stageClass = [
    css.stage,
    canPan ? css.stageCanPan : '',
    panning ? css.stagePanning : '',
  ].filter(Boolean).join(' ')

  return createPortal(
    <div
      ref={rootRef}
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={css.mask} aria-hidden="true" />
      <div
        ref={stageRef}
        className={stageClass}
        data-image-lightbox-stage=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imgRef}
          className={
            failed
              ? `${css.image} ${css.imageFailed}`
              : natural === null
                ? `${css.image} ${css.imagePending}`
                : css.image
          }
          src={src}
          alt={alt}
          draggable={false}
          onLoad={onImageLoad}
          onError={onImageError}
          style={{ transform }}
        />
      </div>
      <div
        className={css.actions}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={css.action}
          aria-label={labels.download}
          disabled={saving || failed}
          onClick={onDownload}
        >
          <IconDownloadOutlineRegular size={16} />
        </button>
        <button ref={closeRef} type="button" className={css.action} aria-label={labels.close} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
      <div className={css.meta} aria-hidden="true">
        <span className={zoomChip ? `${css.zoom} ${css.zoomVisible}` : css.zoom}>
          {`${zoomPercent}%`}
        </span>
        {caption !== '' ? <p className={css.caption}>{caption}</p> : null}
      </div>
    </div>,
    document.body,
  )
}
