/**
 * DSH-style on/off switch (36×20 capsule). Shared by Plugins cards, inventory,
 * Settings preference rows, and presence — one chrome, no per-callsite CSS.
 */

import type { ButtonHTMLAttributes } from 'react'
import clsx from 'clsx'
import css from './Switch.module.css'

export type SwitchProps = {
  /** Whether the switch is on. */
  checked: boolean
  /** Accessible name (usually the row / card title). */
  'aria-label': string
  /** Stage the next value. Omitted while disabled. */
  onCheckedChange?: (next: boolean) => void
  className?: string | undefined
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange' | 'role' | 'aria-checked' | 'aria-label'>

/**
 * Render a binary switch control.
 * @param props - checked state, label, and optional change handler.
 * @returns the switch button.
 */
export function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  'aria-label': ariaLabel,
  type = 'button',
  onClick,
  ...rest
}: SwitchProps) {
  return (
    <button
      type={type}
      className={clsx(css.switch, className)}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || disabled) return
        onCheckedChange?.(!checked)
      }}
      {...rest}
    >
      <span className={css.thumb} aria-hidden="true" />
    </button>
  )
}
