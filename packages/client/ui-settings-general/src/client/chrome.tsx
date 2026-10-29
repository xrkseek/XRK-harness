/**
 * Shell chrome content registered into the shell's trigger/header seats: the
 * trigger row icon + label (figma sidebar foot) and the panel title text.
 * The shell renders the surrounding chrome (button, nav heading row) and
 * reads each entry's `label` option for aria text.
 *
 * Wide foot: show「设置」/ Settings glued to the gear when it fits; if the
 * column is too narrow for the full word (English "Settings" vs short「设置」),
 * drop the label entirely and keep the icon — never ellipsis to a lone "s".
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { IconSettingsOutlineRegular } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import css from './chrome.module.css'

/** Trigger content props: the sidebar column state + the standard locale seat. */
export type TriggerContentProps = PropsRuntime<'settings.trigger'> & PropsLocale<'settings'>

/** Header content props: the standard locale seat only. */
export type HeaderContentProps = PropsRuntime<'settings.header'> & PropsLocale<'settings'>

/** How much horizontal budget the foot row still grants this trigger. */
function triggerBudget(button: HTMLElement): number {
  const row = button.parentElement
  if (row === null) return button.clientWidth
  let siblings = 0
  for (const child of row.children) {
    if (child === button) continue
    siblings += (child as HTMLElement).offsetWidth
  }
  const gap = Number.parseFloat(getComputedStyle(row).gap) || 0
  const gaps = Math.max(0, row.children.length - 1) * gap
  return Math.max(0, row.clientWidth - siblings - gaps)
}

/**
 * Render the trigger row content (icon; label only when the wide foot can
 * fit the full word — otherwise icon-only, matching Desktop 0.6.23).
 * @param props - composed slot props.
 * @returns the trigger content fragment.
 */
export function TriggerContent({ wide, t }: TriggerContentProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const label = t('trigger')
  const [showLabel, setShowLabel] = useState(wide)

  useLayoutEffect(() => {
    if (!wide) {
      setShowLabel(false)
      return
    }
    const root = rootRef.current
    const button = root?.closest('button')
    if (root === null || button === null || button === undefined) {
      setShowLabel(true)
      return
    }

    const sync = (): void => {
      const probe = document.createElement('span')
      probe.textContent = label
      probe.className = css.triggerLabel
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap'
      button.appendChild(probe)
      const labelWidth = probe.offsetWidth
      probe.remove()

      const icon = root.querySelector(`.${css.triggerIcon}`) as HTMLElement | null
      const iconWidth = icon?.offsetWidth ?? 0
      const budget = triggerBudget(button)
      // jsdom / first paint often reports 0×0 — keep the full word until layout is real.
      if (labelWidth === 0 || budget === 0) {
        setShowLabel(true)
        return
      }
      const styles = getComputedStyle(button)
      const pad = (Number.parseFloat(styles.paddingLeft) || 0)
        + (Number.parseFloat(styles.paddingRight) || 0)
      const gap = Number.parseFloat(styles.gap) || 0
      const need = pad + (iconWidth || 16) + gap + labelWidth
      setShowLabel(need <= budget + 0.5)
    }

    sync()
    if (typeof ResizeObserver === 'undefined') return
    const row = button.parentElement
    const ro = new ResizeObserver(sync)
    ro.observe(button)
    if (row !== null) ro.observe(row)
    return () => { ro.disconnect() }
  }, [wide, label])

  return (
    <span ref={rootRef} className={css.triggerInner} data-label={showLabel ? 'on' : 'off'}>
      <span className={css.triggerIcon} aria-hidden="true">
        <IconSettingsOutlineRegular size={wide ? 16 : 18} />
      </span>
      {showLabel ? <span className={css.triggerLabel}>{label}</span> : null}
    </span>
  )
}

/**
 * Render the panel title text.
 * @param props - composed slot props.
 * @returns the title text node.
 */
export function HeaderContent({ t }: HeaderContentProps) {
  return <>{t('title')}</>
}

/** Close-button label text props: the standard locale seat only. */
export type CloseLabelProps = PropsRuntime<'settings.close'> & PropsLocale<'settings'>

/**
 * Render the close button's visually-hidden label text.
 * @param props - composed slot props.
 * @returns the label text node.
 */
export function CloseLabel({ t }: CloseLabelProps) {
  return <>{t('close')}</>
}
