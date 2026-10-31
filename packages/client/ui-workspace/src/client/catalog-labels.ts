/**
 * Localized display names for product catalog 干员 (Host still stores Chinese
 * seed names for playbook identity). Custom members keep their stored name.
 * Built-in manager seat follows live Settings seat titles (中层称呼).
 */
import type { WorkspaceKey } from './locales.ts'
import type { SeatTitles } from './seat-titles.ts'

/** 经理 · 向日葵 — TeamRoster office rail only; not pickable for 干员家. */
export const OFFICE_SEAT_MEMBER_IDS: ReadonlySet<string> = new Set([
  'mem_seed_manager',
  'mem_seed_xrkseek',
])

export function isOfficeSeatMemberId(id: string): boolean {
  return OFFICE_SEAT_MEMBER_IDS.has(id)
}

const CATALOG_NAME_KEYS: Readonly<Record<string, WorkspaceKey>> = {
  mem_seed_manager: 'team.catalog.manager',
  mem_seed_xrkseek: 'team.catalog.sunflower',
  mem_seed_researcher: 'team.catalog.researcher',
  mem_seed_worker: 'team.catalog.worker',
  mem_seed_reviewer: 'team.catalog.reviewer',
  mem_seed_lead: 'team.catalog.lead',
  mem_seed_scout: 'team.catalog.scout',
  mem_seed_docs: 'team.catalog.docs',
  mem_seed_fixer: 'team.catalog.fixer',
  mem_seed_tester: 'team.catalog.tester',
}

const CATALOG_BRIEF_KEYS: Readonly<Record<string, WorkspaceKey>> = {
  mem_seed_manager: 'team.catalog.manager.brief',
  mem_seed_xrkseek: 'team.catalog.sunflower.brief',
  mem_seed_researcher: 'team.catalog.researcher.brief',
  mem_seed_worker: 'team.catalog.worker.brief',
  mem_seed_reviewer: 'team.catalog.reviewer.brief',
  mem_seed_lead: 'team.catalog.lead.brief',
  mem_seed_scout: 'team.catalog.scout.brief',
  mem_seed_docs: 'team.catalog.docs.brief',
  mem_seed_fixer: 'team.catalog.fixer.brief',
  mem_seed_tester: 'team.catalog.tester.brief',
}

type Translate = (
  key: WorkspaceKey,
  params?: Record<string, string | number>,
) => string

/** Localized catalog name, or the stored name for custom / unknown members. */
export function catalogMemberName(
  id: string,
  storedName: string,
  t: Translate,
  seatTitles?: SeatTitles,
): string {
  if (id === 'mem_seed_manager' && seatTitles) return seatTitles.manager
  // Tile / editor name = locale formal only; locked nick `xrkseek` is the
  // nickname field (Face list overlays it). Full chrome is formal（nick）.
  if (id === 'mem_seed_xrkseek') {
    return t('team.catalog.sunflower')
  }
  const key = CATALOG_NAME_KEYS[id]
  return key !== undefined ? t(key) : storedName
}

/** Localized catalog brief when present; otherwise the stored brief. */
export function catalogMemberBrief(
  id: string,
  storedBrief: string | undefined,
  t: Translate,
  seatTitles?: SeatTitles,
): string | undefined {
  const key = CATALOG_BRIEF_KEYS[id]
  if (key !== undefined) {
    return seatTitles
      ? t(key, {
          boss: seatTitles.boss,
          manager: seatTitles.manager,
          agent: seatTitles.agent,
        })
      : t(key)
  }
  const trimmed = storedBrief?.trim()
  return trimmed ? trimmed : undefined
}
