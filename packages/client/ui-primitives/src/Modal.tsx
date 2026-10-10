// Modal: controlled full-viewport dialog (create-workspace and similar).
// The overlay portals to this document's body so ancestor stacking contexts
// cannot leave sticky page controls above the mask. This is still an in-page
// WebUI dialog; it never creates or targets another browser/native window.

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import css from './Modal.module.css'

/**
 * Everything a keyboard can land on. `tabindex="-1"` is excluded on purpose:
 * it marks a programmatically-focusable stop, not one the user tabs through.
 * `[hidden]` and `aria-hidden` subtrees are unreachable by definition, and a
 * trap that counts them will happily pull focus into something invisible.
 */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
].join(',')

/** The controls worth landing on first: typing into a dialog should not start at the close button. */
const TEXT_ENTRY = /^(input|select|textarea)$/i

function tabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  )
}

/**
 * Render a centered modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape or mask click.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.closeLabel - accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, etc.).
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome) for dialogs whose figma frame owns its own
 * header structure; mask, card, Escape, and aria-label remain.
 * @param props.closeLabel - close-button aria label; the owner passes
 * localized copy (this package is cordis-free, so copy arrives via props).
 * @returns null when closed; otherwise the overlay tree.
 */
export function Modal({
  open, onClose, title, closeLabel = 'Close', description, children, footer, className, contentClassName, headless = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
  headless?: boolean
}) {
  // Captured in the effect body, not read from the ref in the cleanup: by the
  // time cleanup runs the dialog is already unmounted and the ref is null.
  const dialogRef = useRef<HTMLDivElement>(null)
  // Callers pass `onClose={() => {}}` inline, so it is a fresh function on every
  // render. Depending on it would tear the focus contract down and rebuild it
  // each time the dialog re-renders — which parks focus on the first field
  // halfway through whatever the user was doing. The effect keys on `open`
  // alone and reads the handler through a ref, so opening is the only trigger.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    // Whoever opened the dialog is where focus belongs when it closes again.
    const restoreTo = document.activeElement as HTMLElement | null

    // Move focus in before anything else, so a screen reader announces the
    // dialog rather than leaving the user on the page behind it. A dialog with
    // no focusable content still needs the container itself as a stop, which
    // is why it carries tabIndex={-1}.
    const stops = dialog ? tabbable(dialog) : []
    // Prefer an explicit autoFocus control (footer Cancel, etc.) over the
    // chrome close button, which is otherwise the first tabbable stop.
    // Button sets data-autofocus when autoFocus is true; React alone may leave
    // neither the HTML attribute nor a reliable IDL property in jsdom.
    const autoFocused = stops.find((el) => (
      el.hasAttribute('data-autofocus')
      || el.hasAttribute('autofocus')
      || (el as HTMLButtonElement | HTMLInputElement).autofocus === true
    ))
    const firstField = stops.find((el) => TEXT_ENTRY.test(el.tagName))
    ;(autoFocused ?? firstField ?? stops[0] ?? dialog)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !dialog) return
      // Focus trap. Without it, Tab walks straight out of the dialog into the
      // page behind, which `aria-modal="true"` promises cannot happen.
      const items = tabbable(dialog)
      if (items.length === 0) { e.preventDefault(); dialog.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault(); first?.focus()
      } else if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault(); last?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Only restore if the trigger still exists: a dialog can be torn down by
      // the very action that closed it (delete-a-row, submit-and-navigate),
      // and focusing a detached node silently drops focus to <body>.
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        className={clsx(css.dialog, className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        /* Programmatic-only stop: reachable by the trap, absent from Tab order
           until the dialog holds nothing else focusable. */
        tabIndex={-1}
      >
        {headless
          ? children
          : (
            <>
              <div className={clsx(css.content, contentClassName)}>
                <div className={css.header}>
                  <h2 className={css.title}>{title}</h2>
                  <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
                    <IconCloseOutline16 size={14} />
                  </button>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={css.description}>{description}</p>
                )}
                {children !== undefined && <div className={css.body}>{children}</div>}
              </div>
              {footer !== undefined && <div className={css.footer}>{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)
}
