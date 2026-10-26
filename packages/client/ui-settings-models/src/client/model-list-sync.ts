/**
 * Row ↔ provider-listing reconciliation for the model list.
 *
 * Kept out of the editor component so the rules can be exercised without
 * mounting a form. They are the whole contract of two buttons: which rows a
 * refresh keeps or drops, which blank fields the provider is allowed to fill,
 * and what a picked candidate carries over. A component test can only see the
 * result after a render; these functions answer for themselves.
 */
import type { DiscoveredModelView } from '@xrkseek/xrk-api-remotes/client'
import { formatCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'

/**
 * One configured model row. Structurally open, exactly like the DeepSeek
 * catalog editor's rows: a profile field this card does not edit — one a future
 * schema adds, or one hand-written in `settings.yaml` — has to survive being
 * edited here rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
export function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
export function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** Capacities a listing may disclose. Existing numbers stay; blanks fill in. */
const DISCLOSED_CAPACITIES = ['contextWindow', 'maxTokens', 'softBudgetMaxTokens'] as const

/**
 * Refresh only the rows the user already configured.
 * - Missing from the provider listing → drop.
 * - Still listed → keep id / display name and any capacity already set.
 * - Blank capacity the listing disclosed → fill it.
 * - Blank intake modes the listing disclosed → fill them.
 * - Thinking menu the listing disclosed → replace.
 * - Blank id → draft still being typed, keep.
 * Never copies upstream `name` onto a hand-edited display name.
 * @param rows - the live rows, not the snapshot a probe was launched with.
 * @param listed - the provider's answer.
 * @returns the rows to write back, in the original order.
 */
export function syncListedModels(
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
    // Intake modes behave like the capacities: a hand-set pair is a decision,
    // a missing one is a blank the listing (or the catalog behind it) may fill.
    if (merged['inputModalities'] === undefined && upstream.inputModalities !== undefined) {
      merged = { ...merged, inputModalities: [...upstream.inputModalities] }
    }
    next.push(merged)
  }
  return next
}

/** Adopt a candidate, keeping whatever capacities the provider disclosed. */
export function adopt(candidate: DiscoveredModelView): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.softBudgetMaxTokens === undefined ? {} : { softBudgetMaxTokens: candidate.softBudgetMaxTokens },
    ...candidate.inputModalities === undefined
      ? {}
      : { inputModalities: [...candidate.inputModalities] },
    // OFM / community listings carry a thinking menu on the row.
    ...candidate.reasoning === undefined ? {} : { reasoning: candidate.reasoning },
  }
}

/**
 * Compact capacity for the picker tail. Field editors still use decimal
 * {@link formatCapacity} (256K → 256000); probe rows often ship binary sizes
 * (131072) that would otherwise print as raw digits.
 */
function formatProbeCapacity(value: number): string {
  const decimal = formatCapacity(value)
  if (decimal !== String(value)) return decimal
  if (!Number.isInteger(value) || value <= 0 || value % 1024 !== 0) return decimal
  const kib = value / 1024
  return kib % 1024 === 0 ? `${String(kib / 1024)}M` : `${String(kib)}K`
}

/**
 * What a probe learned about one candidate, as a compact tail.
 *
 * Capacities are what the picker exists to save the user from typing, and a
 * thinking menu is invisible until the row is adopted and the model selector is
 * opened — so the picker states both. Absent facts stay absent rather than
 * being spelled as zero.
 * @param candidate - one discovered model.
 * @returns the tail text, or undefined when the probe disclosed nothing.
 */
export function candidateFacts(candidate: DiscoveredModelView): string | undefined {
  const parts: string[] = []
  if (candidate.contextWindow !== undefined) {
    parts.push(`${formatProbeCapacity(candidate.contextWindow)} ctx`)
  }
  if (candidate.maxTokens !== undefined) {
    parts.push(`${formatProbeCapacity(candidate.maxTokens)} out`)
  }
  if (candidate.reasoning !== undefined) {
    parts.push(candidate.reasoning.efforts.map(effort => effort.id).join('/'))
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}
