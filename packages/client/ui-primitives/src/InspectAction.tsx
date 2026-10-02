/** Always-visible trajectory Inspect control under expanded tool / skill bodies. */
import type { ButtonHTMLAttributes } from 'react'
import clsx from 'clsx'
import { IconInspectOutline12 } from './icons/index.tsx'
import css from './InspectAction.module.css'

export type InspectActionProps = {
  /** Optional class for layout offsets (margins owned by the row). */
  className?: string | undefined
  /** Visible label; defaults to the product-English Inspect affordance. */
  label?: string | undefined
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'>

/**
 * Compact pill that opens the matching trajectory record. Always rendered
 * when mounted (no hover-reveal); hit area is expanded for dense tool rows.
 */
export function InspectAction({
  className,
  label = 'Inspect',
  onClick,
  ...rest
}: InspectActionProps) {
  return (
    <button
      type="button"
      className={clsx(css.root, className)}
      onClick={onClick}
      {...rest}
    >
      <IconInspectOutline12 />
      {label}
    </button>
  )
}
