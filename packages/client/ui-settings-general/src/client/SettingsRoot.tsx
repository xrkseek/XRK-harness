/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — every piece of text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 *
 * Home-only sections (Plugins today) stay off the Settings nav rail: the
 * sidebar utility opens them as a full-bleed home panel (DSH panellist seat),
 * while the gear menu only lists ordinary preference pages.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ConnectionIndicator,
  IconAgentPresetOutlineRegular, IconCloseOutlineRegular, IconDataOutlineRegular,
  IconSettingsOutlineRegular,
} from '@xrkseek/client-ui-primitives'
import type { ConnectionIndicatorState } from '@xrkseek/client-ui-primitives'
import {
  connectionChromeBusy,
  connectionChromeHalted,
  connectionChromePhaseKey,
} from './connection-chrome.ts'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import { DesktopReleaseFooter } from './DesktopReleaseFooter.tsx'
import css from './SettingsRoot.module.css'

const RECOVERY_CONFIRMATION_MS = 2_000

/**
 * Sections opened from outside Settings (sidebar utility) — not listed in the
 * gear nav. Keep this set small; new home surfaces register here deliberately.
 */
const HOME_ONLY_SECTIONS = new Set(['plugins'])

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutlineRegular className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineRegular className={css.navIcon} size={16} />
  return <IconSettingsOutlineRegular className={css.navIcon} size={16} />
}

type PanelProps = {
  /** Rows shown in the Settings nav rail (home-only sections excluded). */
  navRows: readonly SettingsSectionRow[]
  /** Full ledger — home sections remain reachable via openSection. */
  allRows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
  /** Sidebar trigger — focus returns here when the panel unmounts. */
  openerRef: RefObject<HTMLElement | null>
}

/**
 * Map a location hash to a Settings open request. `#/settings` opens the
 * default rail page; `#/models` / `#/settings/models` (and bare aliases)
 * select that section. Unrelated hashes return null.
 */
function settingsHashTarget(hash: string): { section?: string } | null {
  let path = hash.trim()
  if (path.startsWith('#')) path = path.slice(1)
  // Tolerate `#//settings` and `/settings` probe forms from deep-link audits.
  const parts = path.split('/').filter(part => part.length > 0)
  if (parts.length === 0) return null
  if (parts[0] === 'settings') {
    return parts[1] === undefined ? {} : { section: parts[1] }
  }
  if (
    parts[0] === 'models'
    || parts[0] === 'plugins'
    || parts[0] === 'general'
    || parts[0] === 'agent-presets'
  ) {
    return { section: parts[0] }
  }
  return null
}

/**
 * The modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's). Focus enters on the close
 * control and returns to the opener on unmount (same restore contract as
 * ImageLightbox). While open, `#root` is inert so Tab cannot walk the page
 * behind the dialog (same contract as OnboardingModal / OnboardingSurface).
 */
function SettingsPanel({
  navRows, allRows, renderSlot, activeId, onSelect, onClose, openerRef,
}: PanelProps) {
  const homeRow = activeId !== undefined && HOME_ONLY_SECTIONS.has(activeId)
    ? allRows.find(r => r.id === activeId)
    : undefined
  const homeMode = homeRow !== undefined
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first nav row when the id is gone (never to
  // a home-only section — those only open via openSection).
  const active = homeMode
    ? homeRow.id
    : (navRows.find(r => r.id === activeId)?.id ?? navRows[0]?.id)
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const navListRef = useRef<HTMLDivElement | null>(null)
  const optionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const appRoot = document.getElementById('root')
    const previousInert = appRoot === null ? false : appRoot.inert
    if (appRoot !== null) appRoot.inert = true
    closeButton.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Nested confirm Modals (delete provider, …) own Escape first.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (appRoot !== null) appRoot.inert = previousInert
      openerRef.current?.focus()
    }
  }, [onClose, openerRef])

  // Keep the active section tab in view when the phone nav scroller overflows.
  useEffect(() => {
    if (homeMode) return
    const list = navListRef.current
    if (list === null || active === undefined) return
    const cell = list.querySelector<HTMLElement>('[aria-current="true"]')
    if (cell === null || typeof cell.scrollIntoView !== 'function') return
    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    cell.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    })
  }, [active, homeMode])

  // Tab / programmatic focus into a long `.options` list (plugins, General):
  // scroll the focused control into the viewport (B-10 / H4). Capture so
  // nested switches and inputs fire before their own handlers.
  const onOptionsFocusCapture = (event: FocusEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const root = optionsRef.current
    if (root === null || target === root || !root.contains(target)) return
    if (typeof target.scrollIntoView !== 'function') return
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // Portal to body: the settings trigger lives in the sidebar foot, and phone
  // AppFrame draws the drawer with `transform`, which would otherwise become
  // the containing block for `position: fixed` and crush the panel to the
  // drawer width (~280px). Same escape hatch as Modal / ImageLightbox.
  return createPortal((
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        className={clsx(css.panel, homeMode && css.homePanel)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {!homeMode ? (
          <nav className={css.nav} aria-labelledby={titleId}>
            <h2 className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</h2>
            <div ref={navListRef} className={css.navList}>
              {navRows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  className={clsx(css.navCell, row.id === active && css.active)}
                  aria-current={row.id === active ? 'true' : undefined}
                  onClick={() => { onSelect(row.id) }}
                >
                  {navIcon(row.id)}
                  <span className={css.navLabel}>{row.label}</span>
                </button>
              ))}
            </div>
          </nav>
        ) : null}
        <div className={css.content}>
          <div className={css.header}>
            {homeMode
              ? <h2 className={css.homeTitle} id={titleId}>{homeRow.label}</h2>
              : <div className={css.actions}>{renderSlot('settings.action', {})}</div>}
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutlineRegular size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div
            ref={optionsRef}
            className={css.options}
            onFocusCapture={onOptionsFocusCapture}
          >
            {active !== undefined ? (
              <div key={active} className={css.optionsPane}>
                {renderSlot('settings.section', { close: onClose }, { only: active })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, bindOpenSection, useConnectionState, useConnectionPhase, useSections, useOnboardingSteps, useHostVersion, useSessions, renderSlot, t,
  } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
    // Drop a settings deep-link hash so remount / refresh does not reopen.
    if (settingsHashTarget(window.location.hash) !== null) {
      const url = new URL(window.location.href)
      url.hash = ''
      window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    }
  }, [])

  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  useEffect(() => bindOpenSection(openSection), [bindOpenSection, openSection])

  // Deep links: `#/settings`, `#/models`, `#/settings/models`, …
  useEffect(() => {
    const applyHash = (): void => {
      const target = settingsHashTarget(window.location.hash)
      if (target === null) return
      if (target.section === undefined) {
        setActiveId(undefined)
        setOpen(true)
        return
      }
      openSection(target.section)
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => { window.removeEventListener('hashchange', applyHash) }
  }, [openSection])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const navRows = useMemo(
    () => rows.filter(row => !HOME_ONLY_SECTIONS.has(row.id)),
    [rows],
  )
  const hostVersion = useHostVersion(v => v)
  const connectionState = useConnectionState(state => state)
  const connectionPhase = useConnectionPhase(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  // Flash a brief recovered confirmation after an outage clears (DSH alpha.2).
  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'reconnecting') return
    setShowRecovery(true)
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  // Spinner stays up through wire handshake and first session-list ready
  // (shared Web + Desktop; see connection-chrome.ts).
  const sessionsPhase = useSessions(state => state.phase)
  const chromeFacts = {
    connectionState,
    connectionPhase,
    sessionsPhase,
    showRecovery,
  }
  let connectionIndicator: ConnectionIndicatorState | undefined
  if (showRecovery) {
    connectionIndicator = 'recovered'
  } else if (connectionChromeHalted(chromeFacts)) {
    // Desktop Host budget exhausted — outage chrome, not a forever spinner.
    connectionIndicator = 'disconnected'
  } else if (connectionChromeBusy(chromeFacts)) {
    connectionIndicator = 'connecting'
  }
  const phaseKey = connectionChromePhaseKey(chromeFacts)
  const phaseLabel = phaseKey === undefined ? t('connection.phase.initial') : t(phaseKey)

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        <button
          ref={triggerRef}
          type="button"
          className={clsx(css.trigger, !wide && css.rail)}
          aria-haspopup="dialog"
          aria-expanded={open}
          // Always name the control: rail and wide icon-only (English collapse)
          // paint only the gear — visible「设置」still matches this label.
          aria-label={t('trigger')}
          onClick={() => {
            // Gear opens ordinary Settings — never a leftover home surface.
            setActiveId(undefined)
            setOpen(true)
          }}
        >
          {renderSlot('settings.trigger', { wide })}
        </button>
        <ConnectionIndicator
          state={wide ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          reconnectLabel={t('connection.retry')}
          connectingLabel={t('connection.connecting')}
          phaseLabel={connectionIndicator === 'connecting' ? phaseLabel : undefined}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
        {wide && connectionIndicator === undefined
          ? <DesktopReleaseFooter t={t} hostVersion={hostVersion} />
          : null}
      </div>
      {open && (
        <SettingsPanel
          navRows={navRows}
          allRows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
          openerRef={triggerRef}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
