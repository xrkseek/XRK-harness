import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { useExpandScrollPreserve } from './expand-scroll-preserve.ts'
import { IconChevronDownOutlineRegular } from './icons/index.tsx'
import css from './DisclosureRow.module.css'

/** Shared 24px disclosure chrome for compact flow rows. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  /**
   * When false, skip mid-column scroll preserve on this header. Use when the
   * expanding height lives on a sibling (process-group body) and the parent
   * owns preserve on the shared root.
   */
  preserveScrollOnExpand?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  preserveScrollOnExpand = true,
  collapsedContent,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const { rootRef, noteExpand } = useExpandScrollPreserve(open, preserveScrollOnExpand)
  const rowExpands = expandable && expandOnRowClick

  const runToggle = () => {
    if (!open && expandable) noteExpand()
    onToggle()
  }

  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    runToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    runToggle()
  }
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        <IconChevronDownOutlineRegular className={clsx(chevronClassName, css.chevronHover)} />
      </>
    )
    : icon
  const leading = open
    ? <IconChevronDownOutlineRegular className={chevronClassName} />
    : collapsedLeading

  return (
    <div ref={rootRef} className={clsx(css.root, className)} data-open={open || undefined}>
      {/* DSH wraps the row in [data-disclosure-header]; maid/orca select it. */}
      <div className={css.header} data-disclosure-header="">
        <div
          className={clsx(css.row, rowClassName)}
          data-disclosure-row
          data-expandable={rowExpands || undefined}
          role={rowExpands ? 'button' : undefined}
          tabIndex={rowExpands ? 0 : undefined}
          aria-expanded={rowExpands ? open : undefined}
          onClick={rowExpands ? runToggle : undefined}
          onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
        >
          {expandable && !rowExpands ? (
            <button
              type="button"
              className={clsx(css.leading, leadingClassName)}
              aria-expanded={open}
              onClick={toggleFromLeading}
            >
              {leading}
            </button>
          ) : (
            <span className={clsx(css.leading, leadingClassName)}>
              {leading}
            </span>
          )}
          <span className={clsx(css.title, titleClassName)}>{title}</span>
          {(keepContentWhenOpen || !open) && collapsedContent}
        </div>
      </div>
      {open && children}
    </div>
  )
}
