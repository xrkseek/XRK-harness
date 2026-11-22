import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { useExpandScrollPreserve } from './expand-scroll-preserve.ts'
import {
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
} from './icons/index.tsx'
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
  /**
   * @deprecated No-op. Type icon stays visible; expand state is the trailing
   * chevron (› collapsed / ∨ open). Kept so older call sites type-check.
   */
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
 *
 * Leading = type icon always (思考 / 命令 / tool). Trailing chevron carries
 * expand state: › collapsed, ∨ open. Do not replace the type icon with a
 * chevron — that made every phone row look like the same 「∨」.
 *
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

  const trailChevron = expandable
    ? (
      open
        ? <IconChevronDownOutlineRegular className={clsx(chevronClassName, css.trailChevron)} />
        : <IconChevronRightOutlineRegular className={clsx(chevronClassName, css.trailChevron)} />
    )
    : null

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
              {icon}
            </button>
          ) : (
            <span className={clsx(css.leading, leadingClassName)}>
              {icon}
            </span>
          )}
          <span className={clsx(css.title, titleClassName)}>{title}</span>
          {trailChevron}
          {(keepContentWhenOpen || !open) && collapsedContent}
        </div>
      </div>
      {open && children}
    </div>
  )
}
