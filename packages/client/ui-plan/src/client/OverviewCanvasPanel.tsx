/**
 * Overview Canvas: horizontal chip rail to pick a board, then play it.
 * Soft catalog poll never blanks a matching player (no flash).
 * Report-board layout: hero title, toned KPIs, callouts, bordered tables.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { MarkdownText } from '@xrkseek/client-ui-primitives'
import type { TranslateNS } from '@xrkseek/client-ui-slots'
import css from './OverviewCanvasPanel.module.css'

type PlanTranslate = TranslateNS<'plan'>

export type CanvasTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent'

const CANVAS_TONES = new Set<CanvasTone>(['neutral', 'good', 'warn', 'bad', 'accent'])

function parseTone(raw: unknown): CanvasTone | undefined {
  if (typeof raw !== 'string') return undefined
  return CANVAS_TONES.has(raw as CanvasTone) ? (raw as CanvasTone) : undefined
}

export type OverviewCanvasSummary = {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly updatedAt: string
}

export type OverviewCanvasSection =
  | { readonly kind: 'markdown'; readonly body: string }
  | {
      readonly kind: 'table'
      readonly columns: readonly string[]
      readonly rows: readonly (readonly string[])[]
    }
  | {
      readonly kind: 'kpi'
      readonly items: readonly {
        readonly label: string
        readonly value: string
        readonly tone?: CanvasTone
      }[]
    }
  | {
      readonly kind: 'callout'
      readonly body: string
      readonly title?: string
      readonly tone?: CanvasTone
    }
  | {
      readonly kind: 'series'
      readonly title: string
      readonly points: readonly { readonly x: string; readonly y: number }[]
      readonly tone?: CanvasTone
    }

export type OverviewCanvasDocument = {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly sections: readonly OverviewCanvasSection[]
}

export type CanvasFocusFace = {
  getSnapshot: () => {
    readonly sessionId: string
    readonly id: string
    readonly revision: number
  } | null
  subscribe: (listener: () => void) => () => void
}

type CanvasWireDoc = {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly sections: readonly unknown[]
}

const SOFT_POLL_MS = 8_000

function parseSections(raw: readonly unknown[]): OverviewCanvasSection[] {
  const out: OverviewCanvasSection[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const o = row as Record<string, unknown>
    if ((o.kind === 'markdown' || o.kind === 'md') && typeof o.body === 'string') {
      out.push({ kind: 'markdown', body: o.body })
      continue
    }
    if (o.kind === 'table' && Array.isArray(o.columns) && Array.isArray(o.rows)) {
      out.push({
        kind: 'table',
        columns: o.columns.filter((c): c is string => typeof c === 'string'),
        rows: o.rows
          .filter((r): r is unknown[] => Array.isArray(r))
          .map((r) => r.filter((c): c is string => typeof c === 'string')),
      })
      continue
    }
    if (o.kind === 'kpi' && Array.isArray(o.items)) {
      out.push({
        kind: 'kpi',
        items: o.items
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          .map((item) => {
            const tone = parseTone(item.tone)
            return {
              label: String(item.label ?? ''),
              value: String(item.value ?? ''),
              ...(tone !== undefined ? { tone } : {}),
            }
          })
          .filter((item) => item.label.length > 0),
      })
      continue
    }
    if (o.kind === 'callout' && typeof o.body === 'string') {
      const tone = parseTone(o.tone)
      const title = typeof o.title === 'string' ? o.title.trim() : ''
      out.push({
        kind: 'callout',
        body: o.body,
        ...(title ? { title } : {}),
        ...(tone !== undefined ? { tone } : {}),
      })
      continue
    }
    if (o.kind === 'series' && typeof o.title === 'string' && Array.isArray(o.points)) {
      const tone = parseTone(o.tone)
      out.push({
        kind: 'series',
        title: o.title,
        points: o.points
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => ({
            x: String(p.x ?? ''),
            y: typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : 0,
          })),
        ...(tone !== undefined ? { tone } : {}),
      })
    }
  }
  return out
}

function itemsKey(items: readonly OverviewCanvasSummary[]): string {
  return items.map((row) => `${row.id}:${row.revision}:${row.updatedAt}`).join('|')
}

function SeriesChart({
  title,
  points,
  tone = 'accent',
}: {
  title: string
  points: readonly { readonly x: string; readonly y: number }[]
  tone?: CanvasTone
}) {
  const maxY = Math.max(...points.map((p) => p.y), 1)
  return (
    <section className={css.block} aria-label={title} data-tone={tone}>
      <h3 className={css.blockTitle}>{title}</h3>
      {points.length === 0
        ? <p className={css.muted}>—</p>
        : (
          <div className={css.series} role="img" aria-label={title}>
            {points.map((point, index) => (
              <div key={`${point.x}:${index}`} className={css.seriesCol} title={`${point.x}: ${point.y}`}>
                <div
                  className={css.seriesBar}
                  data-tone={tone}
                  style={{ height: `${Math.max(4, (point.y / maxY) * 100)}%` }}
                />
                <span className={css.seriesX}>{point.x}</span>
              </div>
            ))}
          </div>
        )}
    </section>
  )
}

function CanvasPlayer({
  doc,
  t,
}: {
  doc: OverviewCanvasDocument
  t: PlanTranslate
}) {
  const updated = (() => {
    const ms = Date.parse(doc.updatedAt)
    if (!Number.isFinite(ms)) return doc.updatedAt
    try {
      return new Date(ms).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return doc.updatedAt
    }
  })()

  return (
    <article className={css.player} aria-label={doc.title} data-canvas-id={doc.id}>
      <header className={css.playerHeader}>
        <h2 className={css.playerTitle}>{doc.title}</h2>
        <p className={css.playerMeta}>
          {t('preview.canvas.revision', { revision: String(doc.revision) })}
          {' · '}
          {updated}
        </p>
      </header>
      {doc.sections.length === 0
        ? <p className={css.muted}>{t('preview.canvas.emptySections')}</p>
        : doc.sections.map((section, index) => {
          if (section.kind === 'markdown') {
            return (
              <section key={index} className={css.block}>
                <div className={css.prose}>
                  <MarkdownText text={section.body} />
                </div>
              </section>
            )
          }
          if (section.kind === 'callout') {
            const tone = section.tone ?? 'warn'
            return (
              <aside
                key={index}
                className={css.callout}
                data-tone={tone}
                aria-label={section.title ?? 'callout'}
              >
                {section.title
                  ? <h3 className={css.calloutTitle} data-tone={tone}>{section.title}</h3>
                  : null}
                <div className={css.calloutBody}>
                  <MarkdownText text={section.body} />
                </div>
              </aside>
            )
          }
          if (section.kind === 'table') {
            return (
              <section key={index} className={css.block}>
                <div className={css.tableWrap}>
                  <table className={css.table}>
                    <thead>
                      <tr>
                        {section.columns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {section.columns.map((_, colIndex) => (
                            <td key={colIndex}>{row[colIndex] ?? ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          }
          if (section.kind === 'kpi') {
            return (
              <section key={index} className={css.kpiGrid} aria-label="KPI">
                {section.items.map((item) => {
                  const tone = item.tone ?? 'neutral'
                  return (
                    <div key={item.label} className={css.kpiCard} data-tone={tone}>
                      <span className={css.kpiValue} data-tone={tone}>{item.value}</span>
                      <span className={css.kpiLabel}>{item.label}</span>
                    </div>
                  )
                })}
              </section>
            )
          }
          return (
            <SeriesChart
              key={index}
              title={section.title}
              points={section.points}
              tone={section.tone}
            />
          )
        })}
    </article>
  )
}

export function OverviewCanvasPanel({
  sessionId,
  focusFace,
  listCanvases,
  getCanvas,
  t,
}: {
  sessionId: string
  focusFace?: CanvasFocusFace
  listCanvases: (signal: AbortSignal) => Promise<{
    readonly workspaceId: string
    readonly generation: number
    readonly items: readonly OverviewCanvasSummary[]
  }>
  getCanvas: (id: string, signal: AbortSignal) => Promise<CanvasWireDoc | null>
  t: PlanTranslate
}) {
  const [items, setItems] = useState<readonly OverviewCanvasSummary[]>([])
  const [generation, setGeneration] = useState(0)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [doc, setDoc] = useState<OverviewCanvasDocument | null | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [boot, setBoot] = useState(true)
  const listRef = useRef(listCanvases)
  const getRef = useRef(getCanvas)
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  listRef.current = listCanvases
  getRef.current = getCanvas

  useEffect(() => {
    if (!focusFace) return
    const apply = (): void => {
      const next = focusFace.getSnapshot()
      if (next !== null && next.sessionId === sessionId) setSelectedId(next.id)
    }
    apply()
    return focusFace.subscribe(apply)
  }, [focusFace, sessionId])

  useEffect(() => {
    let alive = true
    let request: AbortController | undefined

    const applyCatalog = (
      value: {
        readonly workspaceId: string
        readonly generation: number
        readonly items: readonly OverviewCanvasSummary[]
      },
      soft: boolean,
    ): void => {
      setItems((prev) => (itemsKey(prev) === itemsKey(value.items) ? prev : value.items))
      setGeneration((prev) => (prev === value.generation ? prev : value.generation))
      setSelectedId((current) => {
        if (current && value.items.some((row) => row.id === current)) return current
        return value.items[0]?.id
      })
      setError(undefined)
      if (!soft) setBoot(false)
    }

    const load = (soft: boolean): void => {
      request?.abort()
      const ac = new AbortController()
      request = ac
      void listRef.current(ac.signal).then(
        (value) => {
          if (!alive || ac.signal.aborted) return
          applyCatalog(value, soft)
        },
        (err: unknown) => {
          if (!alive || ac.signal.aborted) return
          if (!soft) {
            setError(err instanceof Error ? err.message : String(err))
            setItems([])
            setBoot(false)
          }
        },
      )
    }

    setBoot(true)
    setDoc(undefined)
    setItems([])
    setSelectedId(undefined)
    setError(undefined)
    load(false)
    const timer = window.setInterval(() => { load(true) }, SOFT_POLL_MS)
    return () => {
      alive = false
      request?.abort()
      window.clearInterval(timer)
    }
  }, [sessionId])

  useEffect(() => {
    if (!selectedId) {
      setDoc(undefined)
      return
    }
    const ac = new AbortController()
    const targetId = selectedId
    setDoc((prev) => (prev && prev.id !== targetId ? undefined : prev))
    void getRef.current(targetId, ac.signal).then(
      (value) => {
        if (ac.signal.aborted) return
        if (!value) {
          setDoc(null)
          return
        }
        const next: OverviewCanvasDocument = {
          ...value,
          sections: parseSections(value.sections),
        }
        setDoc((prev) => (
          prev
          && prev.id === next.id
          && prev.revision === next.revision
          && prev.updatedAt === next.updatedAt
            ? prev
            : next
        ))
      },
      (err: unknown) => {
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setDoc(null)
      },
    )
    return () => { ac.abort() }
  }, [selectedId, generation])

  useEffect(() => {
    if (!selectedId) return
    chipRefs.current.get(selectedId)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [selectedId])

  if (error !== undefined && items.length === 0) {
    return <div className={css.empty}>{error}</div>
  }

  if (boot && items.length === 0) {
    return <div className={css.empty} data-overview-canvas="">{t('preview.canvas.loading')}</div>
  }

  if (items.length === 0) {
    return (
      <div className={css.empty} data-overview-canvas="">
        <p className={css.emptyTitle}>{t('preview.canvas.empty')}</p>
        <p className={css.hint}>{t('preview.canvas.emptyHint')}</p>
      </div>
    )
  }

  const pending = !!doc && doc.id !== selectedId
  const showLoading = doc === undefined || pending

  const onRailKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()
    const at = selectedId ? items.findIndex((row) => row.id === selectedId) : 0
    const base = at < 0 ? 0 : at
    let next = base
    if (event.key === 'ArrowRight') next = Math.min(items.length - 1, base + 1)
    else if (event.key === 'ArrowLeft') next = Math.max(0, base - 1)
    else if (event.key === 'Home') next = 0
    else next = items.length - 1
    const row = items[next]
    if (!row) return
    setSelectedId(row.id)
    chipRefs.current.get(row.id)?.focus()
  }

  return (
    <div className={css.root} data-overview-canvas="">
      <div className={css.picker}>
        <div
          className={css.rail}
          role="tablist"
          aria-label={t('preview.canvas.list')}
          onKeyDown={onRailKeyDown}
        >
          {items.map((row) => (
            <button
              key={row.id}
              ref={(node) => {
                if (node) chipRefs.current.set(row.id, node)
                else chipRefs.current.delete(row.id)
              }}
              type="button"
              role="tab"
              className={css.chip}
              aria-selected={selectedId === row.id}
              tabIndex={selectedId === row.id ? 0 : -1}
              data-selected={selectedId === row.id || undefined}
              title={row.id}
              onClick={() => { setSelectedId(row.id) }}
            >
              {row.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={css.refresh}
          aria-label={t('preview.canvas.refresh')}
          title={t('preview.canvas.refresh')}
          onClick={() => {
            const ac = new AbortController()
            void listRef.current(ac.signal).then(
              (value) => {
                setItems((prev) => (itemsKey(prev) === itemsKey(value.items) ? prev : value.items))
                setGeneration((prev) => (prev === value.generation ? prev : value.generation))
                setSelectedId((current) => {
                  if (current && value.items.some((row) => row.id === current)) return current
                  return value.items[0]?.id
                })
                setError(undefined)
              },
              () => {},
            )
          }}
        >
          {t('preview.canvas.refresh')}
        </button>
      </div>
      <div className={css.playPane} data-pending={pending || undefined}>
        {doc === null
          ? <div className={css.empty}>{t('preview.canvas.unavailable')}</div>
          : doc
            ? <CanvasPlayer doc={doc} t={t} />
            : null}
        {showLoading
          ? <div className={css.loadingMask} aria-busy="true">{t('preview.canvas.loading')}</div>
          : null}
      </div>
    </div>
  )
}
