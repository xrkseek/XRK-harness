/**
 * Live Overview (details column) open state for conversation chrome.
 * Prefers AppFrame `[data-dsh-frame][data-details-collapsed]` (desktop + phone
 * sheet). Falls back to the layout inset stamp when the frame is not mounted.
 */
import { useEffect, useState } from 'react'

const DETAILS_INSET_ATTR = 'data-xrk-layout-details'
const FRAME_SELECTOR = '[data-dsh-frame]'

/** @returns true when the Status / Overview column (or phone sheet) is open. */
export function readOverviewOpen(): boolean {
  if (typeof document === 'undefined') return false
  const frame = document.querySelector(FRAME_SELECTOR)
  if (frame !== null) return !frame.hasAttribute('data-details-collapsed')
  return document.documentElement.hasAttribute(DETAILS_INSET_ATTR)
}

/** Subscribe to Overview open/close for presence handoff chrome. */
export function useOverviewOpen(): boolean {
  const [open, setOpen] = useState(readOverviewOpen)

  useEffect(() => {
    let frameObs: MutationObserver | undefined
    let frame: Element | null = null

    const sync = (): void => {
      const next = readOverviewOpen()
      setOpen((prev) => (prev === next ? prev : next))
    }

    const watchFrame = (): void => {
      const nextFrame = document.querySelector(FRAME_SELECTOR)
      if (nextFrame === frame) return
      frameObs?.disconnect()
      frame = nextFrame
      if (frame !== null) {
        frameObs = new MutationObserver(sync)
        frameObs.observe(frame, {
          attributes: true,
          attributeFilter: ['data-details-collapsed'],
        })
      }
      sync()
    }

    const htmlObs = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          sync()
          return
        }
        // Frame may appear after first paint — only re-bind, no subtree flood.
        if (record.type === 'childList') {
          watchFrame()
          return
        }
      }
    })

    watchFrame()
    htmlObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [DETAILS_INSET_ATTR],
      childList: true,
    })
    // One level under body is enough to catch AppFrame mount.
    if (document.body) {
      htmlObs.observe(document.body, { childList: true })
    }

    return () => {
      frameObs?.disconnect()
      htmlObs.disconnect()
    }
  }, [])

  return open
}
