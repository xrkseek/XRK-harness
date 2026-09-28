/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent, type ReactNode,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@xrkseek/xrk-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, Toast,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** Case-insensitive substring match over model id, name, and provider group. */
function matchesModelQuery(
  query: string,
  groupName: string,
  model: { id: string; name: string; description?: string },
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  const haystack = [
    groupName,
    model.id,
    model.name,
    model.description ?? '',
  ].join('\n').toLowerCase()
  return haystack.includes(needle)
}

/**
 * Wrap the first case-insensitive hit of `query` in `<mark>` (PopupSelect-style
 * semantic cue while the search input keeps focus).
 */
function markQuery(text: string, query: string): ReactNode {
  const needle = query.trim()
  if (needle.length === 0) return text
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className={css.mark}>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

/** Flat filtered model row used for virtual search highlight. */
interface FlatModel {
  groupId: string
  model: { id: string; name: string; description?: string }
}

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [search, setSearch] = useState('')
  // Virtual row while the search input keeps focus (PopupSelectView pattern).
  const [highlight, setHighlight] = useState(0)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Pane switches unmount the focused row and drop focus onto document.body,
  // outside the card — keyboard stops reaching the menu. Name the landing
  // target before each switch (DSH paneFocus).
  const paneFocus = useRef<'drill' | 'model' | 'effort' | null>(null)
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const modelCount = choices.length
  const filteredGroups = useMemo(() => state.groups
    .map(group => ({
      ...group,
      models: group.models.filter(model => matchesModelQuery(search, group.name, model)),
    }))
    .filter(group => group.models.length > 0), [search, state.groups])
  const flatModels = useMemo<readonly FlatModel[]>(() => filteredGroups.flatMap(group =>
    group.models.map(model => ({ groupId: group.id, model })),
  ), [filteredGroups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    // Reset the virtual highlight when the filtered set or pane changes.
    setHighlight(0)
  }, [search, pane, open])

  useEffect(() => {
    if (!open || pane !== 'model') return
    const row = rootRef.current?.querySelector('[data-model-highlight="true"]')
    if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' })
    }
  }, [highlight, open, pane, flatModels])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (directory.getSnapshot().status === 'selecting') return
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open, directory])

  useEffect(() => {
    const intent = paneFocus.current
    paneFocus.current = null
    if (!open || intent === null) return
    if (intent === 'drill') {
      // Large catalogs mount a search field: keep the keyboard there so ↑↓
      // can drive the virtual highlight (PopupSelectView). Small catalogs
      // land on the checked row instead.
      if (pane === 'model' && searchRef.current !== null) {
        searchRef.current.focus()
        return
      }
      const checked = rootRef.current?.querySelector<HTMLElement>(
        '[role="menuitemradio"][aria-checked="true"]:not([disabled])',
      )
      const target = checked ?? itemRefs.current.find(item => item !== null && !item.disabled)
      ;(target ?? triggerRef.current)?.focus()
      return
    }
    const cell = itemRefs.current[intent === 'effort' ? 1 : 0]
    ;(cell !== null && cell !== undefined && !cell.disabled ? cell : triggerRef.current)?.focus()
  }, [open, pane])

  if (!available) return null

  const show = (): void => {
    triggerRef.current?.focus()
    setPane('root')
    setSearch('')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    // Keep the menu open while selectModel is in flight so the waiting strip
    // stays visible (DSH rc.2 "preparing · reduced wait"). Read the store
    // (not the render-time `busy` flag) so settleSelection can close after
    // the Host accepts — the promise resolves before React re-renders.
    if (directory.getSnapshot().status === 'selecting') return
    setOpen(false)
    setPane('root')
    setSearch('')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const drill = (next: Exclude<Pane, 'root'>): void => {
    paneFocus.current = 'drill'
    setPane(next)
  }

  /** Leave a drilled pane for the root; hand the keyboard back to its cell. */
  const back = (from: Exclude<Pane, 'root'>): void => {
    paneFocus.current = from
    setPane('root')
    setSearch('')
  }

  const moveFocus = (offset: number): void => {
    // Read live rows from the open card (not the render-time itemRefs bag): a
    // keydown can race a commit that has cleared the ref array mid-render.
    const items = [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])',
      ) ?? []),
    ]
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    // Focus outside the rows (trigger still holds it while the menu opens)
    // enters at the end the step comes from: first forward, last backward.
    const next = active === -1
      ? (offset > 0 ? 0 : items.length - 1)
      : (active + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') back(pane)
      else close(true)
      return
    }
    if (!open) return
    // Search keeps focus; arrows drive a virtual highlight (PopupSelectView).
    if (pane === 'model' && event.target === searchRef.current) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const len = flatModels.length
        if (len === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight(index => (index + step + len) % len)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const pick = flatModels[highlight]
        if (pick !== undefined && !busy) {
          choose({ provider: pick.groupId, model: pick.model.id })
        }
        return
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    // jsdom often omits relatedTarget on programmatic focus moves inside the
    // card; defer and keep the menu open when focus stayed in the subtree.
    queueMicrotask(() => {
      if (rootRef.current?.contains(document.activeElement)) return
      close()
    })
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : effortLabel === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-busy={busy || undefined}
        title={busy ? t('status.selecting') : triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {busy
            ? (
              <div className={css.status} role="status" data-model-status="selecting">
                {t('status.selecting')}
              </div>
            )
            : null}
          {pane === 'root' && (
            <>
              <button
                ref={itemRef()}
                type="button"
                role="menuitem"
                className={css.cell}
                onClick={() => { setSearch(''); drill('model') }}
                disabled={busy}
              >
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitem"
                  className={css.cell}
                  onClick={() => { drill('effort') }}
                  disabled={busy}
                >
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              {modelCount > 5 && (
                <input
                  ref={searchRef}
                  className={css.search}
                  type="search"
                  value={search}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.aria')}
                  onChange={(event) => { setSearch(event.target.value) }}
                />
              )}
              {filteredGroups.length > 0
                ? (
                  <div className={clsx(css.groups, 'scrollable')}>
                    {filteredGroups.map((group) => {
                      const headingId = `${id}-${group.id}`
                      return (
                        <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                          <div className={css.groupTitle} id={headingId}>{group.name}</div>
                          {group.models.map((model) => {
                            const selected = state.current?.provider === group.id && state.current.model === model.id
                            const flatIndex = flatModels.findIndex(
                              row => row.groupId === group.id && row.model.id === model.id,
                            )
                            // Virtual highlight only while the search field is mounted
                            // (catalog large enough); otherwise focus-visible carries the cue.
                            const active = modelCount > 5 && flatIndex === highlight
                            return (
                              <button
                                ref={itemRef()}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                aria-selected={active}
                                data-model-highlight={active || undefined}
                                className={clsx(css.option, selected && css.selected, active && css.optionActive)}
                                key={model.id}
                                title={model.name}
                                disabled={busy}
                                onMouseEnter={() => { if (flatIndex >= 0) setHighlight(flatIndex) }}
                                onClick={() => { choose({ provider: group.id, model: model.id }) }}
                              >
                                <span className={css.optionCopy}>
                                  <span className={css.modelName}>{markQuery(model.name, search)}</span>
                                  {model.description !== undefined && (
                                    <span className={css.description}>{model.description}</span>
                                  )}
                                </span>
                                <span className={css.check}>
                                  {selected ? <IconCheckOutline16 /> : null}
                                </span>
                              </button>
                            )
                          })}
                        </section>
                      )
                    })}
                  </div>
                )
                : state.status === 'ready' && modelCount > 0
                  ? <div className={css.empty}>{t('search.noResults')}</div>
                  : null}
              {state.status === 'ready' && modelCount === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                      {level.description !== undefined && (
                        <span className={css.description}>{level.description}</span>
                      )}
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
