/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DiscoveredModelView, IApiClient } from '@xrkseek/xrk-api-remotes/client'
import { Button, Modal } from '@xrkseek/client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Structurally open, exactly like the DeepSeek
 * catalog editor's rows: a profile field this card does not edit — one a future
 * schema adds, or one hand-written in `settings.yaml` — has to survive being
 * edited here rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** Wire face the fetch action calls. */
  api: Pick<IApiClient, 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
}

/** Disclosure chevron; rotates to point down while its row is open. */
function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Removal glyph for one model row. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** Token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField =
  | 'contextWindow'
  | 'maxTokens'
  | 'softBudgetMaxTokens'
  | 'softBudgetKeepTokens'
  | 'softBudgetBufferTokens'

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
  softBudgetMaxTokens: '300K',
  softBudgetKeepTokens: '24K',
  softBudgetBufferTokens: '4K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Capacities a listing may disclose. Existing numbers stay; blanks fill in. */
const DISCLOSED_CAPACITIES = ['contextWindow', 'maxTokens', 'softBudgetMaxTokens'] as const

/**
 * Refresh only the rows the user already configured.
 * - Missing from the provider listing → drop.
 * - Still listed → keep id / display name and any capacity already set.
 * - Blank capacity the listing disclosed → fill it.
 * - Thinking menu the listing disclosed → replace.
 * - Blank id → draft still being typed, keep.
 * Never copies upstream `name` onto a hand-edited display name.
 */
function syncListedModels(
  rows: readonly ModelDraft[],
  listed: readonly DiscoveredModelView[],
): ModelDraft[] {
  const byId = new Map(listed.map(model => [model.id, model]))
  const next: ModelDraft[] = []
  for (const row of rows) {
    const id = textOf(row, 'id')
    if (id === '') {
      next.push(row)
      continue
    }
    const upstream = byId.get(id)
    if (upstream === undefined) continue
    let merged: ModelDraft = row
    if (upstream.reasoning !== undefined) {
      merged = { ...merged, reasoning: upstream.reasoning }
    }
    for (const field of DISCLOSED_CAPACITIES) {
      const disclosed = upstream[field]
      if (numberOf(merged, field) === undefined && typeof disclosed === 'number') {
        merged = { ...merged, [field]: disclosed }
      }
    }
    next.push(merged)
  }
  return next
}

/** Adopt a candidate, keeping whatever capacities the provider disclosed. */
function adopt(candidate: DiscoveredModelView): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.softBudgetMaxTokens === undefined ? {} : { softBudgetMaxTokens: candidate.softBudgetMaxTokens },
    // OFM / community listings carry a thinking menu on the row.
    ...candidate.reasoning === undefined ? {} : { reasoning: candidate.reasoning },
  }
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, api, t, disabled } = props
  const [probeKind, setProbeKind] = useState<'fetch' | 'refresh' | undefined>(undefined)
  const busy = probeKind !== undefined
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // Rows carry an id and a name; capacities are the exception, so they stay
  // folded until asked for rather than crowding every row with four inputs.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

  /** Buffer key for one capacity field; the row half moves when rows do. */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  /** Drop one row's entries and shift the rows after it down, in one pass. */
  const reindexOnRemove = (
    current: ReadonlyMap<string, string>,
    index: number,
  ): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const toggleExpanded = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const patch = (index: number, next: Record<string, string | number | undefined>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const askListing = async (options?: {
    readonly allowEmpty?: boolean
  }): Promise<readonly DiscoveredModelView[] | undefined> => {
    setFailure(undefined)
    setNotice(undefined)
    try {
      const response = await api.llm.discoverModels({
        settingsNs: probe.settingsNs,
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return undefined
      }
      const found: readonly DiscoveredModelView[] = response.result.value.models
      if (found.length === 0 && options?.allowEmpty !== true) {
        setFailure(t('fetchEmpty'))
        return undefined
      }
      return found
    } catch (error) {
      // The transport rejected rather than answering; without this the button
      // would stay busy with nothing shown.
      setFailure(messageOf(error))
      return undefined
    }
  }

  const fetchModels = async (): Promise<void> => {
    setProbeKind('fetch')
    try {
      const found = await askListing()
      if (found === undefined) return
      // Default every discovered model to checked; the user can deselect
      // before adopting. Already-configured rows are merged without
      // overwriting tuned capacities.
      setCandidates(found)
      setPicked(new Set(found.map(model => model.id)))
    } finally {
      setProbeKind(undefined)
    }
  }

  const refreshModels = async (): Promise<void> => {
    setProbeKind('refresh')
    try {
      // Empty listing is a real answer: every configured id is gone upstream.
      const found = await askListing({ allowEmpty: true })
      if (found === undefined) return
      onChange(syncListedModels(models, found))
      // Row positions move when stale ids leave, so open capacity editors
      // and half-typed buffers would land on the wrong row.
      setExpanded(new Set())
      setEditing(new Map())
      setNotice(t('refreshModelsDone'))
    } finally {
      setProbeKind(undefined)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      // Blank soft budget is the one gap we still fill: leave a hand-set
      // ceiling alone, but stamp the derived one when the field was never set.
      const existing = byId.get(candidate.id)
      if (existing === undefined) {
        byId.set(candidate.id, adopt(candidate))
        continue
      }
      // Keep hand-tuned capacities / display names; still refresh the thinking
      // menu (same rule as Refresh list) and fill a blank soft-budget ceiling.
      let next = existing
      if (
        numberOf(existing, 'softBudgetMaxTokens') === undefined
        && candidate.softBudgetMaxTokens !== undefined
      ) {
        next = { ...next, softBudgetMaxTokens: candidate.softBudgetMaxTokens }
      }
      if (candidate.reasoning !== undefined) {
        next = { ...next, reasoning: candidate.reasoning }
      }
      if (next !== existing) byId.set(candidate.id, next)
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const allCandidatesPicked = candidates !== undefined
    && candidates.length > 0
    && candidates.every(candidate => picked.has(candidate.id))

  const toggleAllCandidates = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    setPicked(allCandidatesPicked
      ? new Set()
      : new Set(candidates.map(candidate => candidate.id)))
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        <div className={styles['modelListActions']}>
          {props.overridden === true && props.onReset !== undefined
            ? (
              <button
                type="button"
                className={styles['linkButton']}
                disabled={disabled}
                onClick={props.onReset}
              >
                {t('resetModels')}
              </button>
            )
            : null}
          <button
            type="button"
            className={styles['linkButton']}
            disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
            title={props.probeBlocked !== undefined
              ? t(props.probeBlocked)
              : askable ? t('refreshModelsHint') : t('fetchNeedsBaseUrl')}
            onClick={() => { void refreshModels() }}
          >
            {probeKind === 'refresh' ? t('refreshingModels') : t('refreshModels')}
          </button>
          <button
            type="button"
            className={styles['linkButton']}
            disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
            title={props.probeBlocked !== undefined
              ? t(props.probeBlocked)
              : askable ? undefined : t('fetchNeedsBaseUrl')}
            onClick={() => { void fetchModels() }}
          >
            {probeKind === 'fetch' ? t('fetching') : t('fetchModels')}
          </button>
        </div>
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => (
        <div key={index} className={styles['modelEntry']}>
          <div className={styles['modelRow']}>
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'id')}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'name')}
              placeholder={t('modelName')}
              aria-label={`${t('modelName')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
            />
            <button
              type="button"
              className={styles['iconButton']}
              aria-label={`${t('modelAdvanced')} ${index + 1}`}
              aria-expanded={expanded.has(index)}
              title={t('modelAdvanced')}
              onClick={() => { toggleExpanded(index) }}
            >
              <IconChevron open={expanded.has(index)} />
            </button>
            <button
              type="button"
              className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
              aria-label={`${t('removeModel')} ${index + 1}`}
              title={t('removeModel')}
              disabled={disabled}
              onClick={() => {
                onChange(models.filter((_model, at) => at !== index))
                // Both stores are keyed by position, so every row after this
                // one shifts down and would otherwise inherit its neighbour's
                // state — a different row's capacities popping open, or its
                // half-typed text appearing in another row's field.
                setExpanded((current) => {
                  const next = new Set<number>()
                  for (const at of current) {
                    if (at < index) next.add(at)
                    else if (at > index) next.add(at - 1)
                  }
                  return next
                })
                setEditing(current => reindexOnRemove(current, index))
              }}
            >
              <IconTrash />
            </button>
          </div>
          {expanded.has(index)
            ? (
              <div className={styles['modelAdvanced']}>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('modelContextWindow')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'contextWindow')}
                    placeholder={CAPACITY_HINT.contextWindow}
                    aria-label={`${t('modelContextWindow')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('modelMaxTokens')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'maxTokens')}
                    placeholder={CAPACITY_HINT.maxTokens}
                    aria-label={`${t('modelMaxTokens')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('softBudgetMaxTokens')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'softBudgetMaxTokens')}
                    placeholder={t('softBudgetMaxTokensPlaceholder')}
                    aria-label={`${t('softBudgetMaxTokens')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'softBudgetMaxTokens', event.target.value) }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('softBudgetKeepTokens')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'softBudgetKeepTokens')}
                    placeholder={t('softBudgetKeepTokensPlaceholder')}
                    aria-label={`${t('softBudgetKeepTokens')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'softBudgetKeepTokens', event.target.value) }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('maxConcurrentSessions')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={typeof model['maxConcurrentSessions'] === 'number'
                      ? String(model['maxConcurrentSessions'])
                      : ''}
                    placeholder={t('maxConcurrentSessionsPlaceholder')}
                    aria-label={`${t('maxConcurrentSessions')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => {
                      const text = event.target.value.trim()
                      if (text.length === 0) {
                        patch(index, { maxConcurrentSessions: undefined })
                        return
                      }
                      const parsed = Number(text)
                      patch(index, {
                        maxConcurrentSessions: Number.isInteger(parsed) ? parsed : Number.NaN,
                      })
                    }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('softBudgetBufferTokens')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'softBudgetBufferTokens')}
                    placeholder={t('softBudgetBufferTokensPlaceholder')}
                    aria-label={`${t('softBudgetBufferTokens')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'softBudgetBufferTokens', event.target.value) }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('modelProxy')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    value={typeof model['proxy'] === 'string' ? model['proxy'] : ''}
                    placeholder={t('modelProxyPlaceholder')}
                    aria-label={`${t('modelProxy')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => {
                      const text = event.target.value.trim()
                      patch(index, { proxy: text.length === 0 ? undefined : event.target.value })
                    }}
                  />
                </label>
                <div className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('inputModalities')}</span>
                  <div className={styles['modalityRow']}>
                    <label className={styles['modalityCheck']}>
                      <input
                        type="checkbox"
                        checked={Array.isArray(model['inputModalities'])
                          ? (model['inputModalities'] as unknown[]).includes('text')
                          : true}
                        disabled={disabled}
                        onChange={(event) => {
                          const cur = Array.isArray(model['inputModalities'])
                            ? [...(model['inputModalities'] as ("text" | "image")[])]
                            : (['text'] as ("text" | "image")[])
                          const next = event.target.checked
                            ? (cur.includes('text') ? cur : [...cur, 'text' as const])
                            : cur.filter(m => m !== 'text')
                          patch(index, { inputModalities: next.length > 0 ? next : ['text'] })
                        }}
                      />
                      {t('modalityText')}
                    </label>
                    <label className={styles['modalityCheck']}>
                      <input
                        type="checkbox"
                        checked={Array.isArray(model['inputModalities'])
                          ? (model['inputModalities'] as unknown[]).includes('image')
                          : false}
                        disabled={disabled}
                        onChange={(event) => {
                          const cur = Array.isArray(model['inputModalities'])
                            ? [...(model['inputModalities'] as ("text" | "image")[])]
                            : (['text'] as ("text" | "image")[])
                          const next = event.target.checked
                            ? (cur.includes('image') ? cur : [...cur, 'image' as const])
                            : cur.filter(m => m !== 'image')
                          patch(index, { inputModalities: next.length > 0 ? next : ['text'] })
                        }}
                      />
                      {t('modalityImage')}
                    </label>
                  </div>
                </div>
              </div>
            )
            : null}
        </div>
      ))}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {notice !== undefined && failure === undefined
        ? <p className={styles['advancedHint']}>{notice}</p>
        : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked} disabled={picked.size === 0}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        {candidates !== undefined && candidates.length > 0
          ? (
            <div className={styles['fetchPickerToolbar']}>
              <button
                type="button"
                className={styles['linkButton']}
                onClick={toggleAllCandidates}
              >
                {allCandidatesPicked ? t('fetchDeselectAll') : t('fetchSelectAll')}
              </button>
            </div>
          )
          : null}
        <ul className={styles['candidateList']}>
          {(candidates ?? []).map(candidate => (
            <li key={candidate.id} className={styles['candidate']}>
              <label className={styles['candidateLabel']}>
                <input
                  type="checkbox"
                  checked={picked.has(candidate.id)}
                  onChange={() => { toggle(candidate.id) }}
                />
                {/* The id alone: it is the string adoption writes, and the
                    capacities the endpoint reported are adopted with it and
                    editable in the row that appears. */}
                <span className={styles['candidateId']}>{candidate.id}</span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  )
}
