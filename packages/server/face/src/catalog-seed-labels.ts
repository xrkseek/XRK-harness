/**
 * Built-in catalog member display names — Host foundation for zh / en / ja.
 * Storage may keep a stable seed `name`; paint / inject / team chrome resolve here.
 */

import {
  displayMemberName,
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
  SUNFLOWER_NICKNAME,
} from "./agent-roster-store.js";
import type { SeatTitleLocale, SeatTitles } from "./seat-titles.js";

/** Locked English call-name for 向日葵. */
export { SUNFLOWER_NICKNAME, SUNFLOWER_NICKNAME as SUNFLOWER_FORMAL_NAME };

/** Locale formal name for 向日葵 (not the nick). */
export function sunflowerFormalName(
  locale: SeatTitleLocale = "zh",
): string {
  if (locale === "en") return "Sunflower";
  if (locale === "ja") return "ひまわり";
  return "向日葵";
}

/** Locked nickname — always `xrkseek`, not user-editable. */
export function sunflowerLockedNickname(
  _locale: SeatTitleLocale = "zh",
): string {
  return SUNFLOWER_NICKNAME;
}

/** `向日葵（xrkseek）` / `Sunflower（xrkseek）` / `ひまわり（xrkseek）`. */
export function sunflowerDisplayLabel(
  locale: SeatTitleLocale = "zh",
): string {
  return displayMemberName(
    sunflowerFormalName(locale),
    sunflowerLockedNickname(locale),
  );
}

/**
 * Locale formal names for non-manager / non-sunflower catalog seeds.
 * Manager uses live Settings seat titles; sunflower uses {@link sunflowerFormalName}.
 */
const CATALOG_SEED_FORMAL: Readonly<
  Record<string, Readonly<Record<SeatTitleLocale, string>>>
> = {
  mem_seed_researcher: {
    zh: "调研员",
    en: "Researcher",
    ja: "リサーチャー",
  },
  mem_seed_worker: {
    zh: "施工员",
    en: "Builder",
    ja: "ビルダー",
  },
  mem_seed_reviewer: {
    zh: "审稿员",
    en: "Reviewer",
    ja: "レビュアー",
  },
  mem_seed_lead: {
    zh: "调度员",
    en: "Lead",
    ja: "リード",
  },
  mem_seed_scout: {
    zh: "探网员",
    en: "Web scout",
    ja: "Web 偵察",
  },
  mem_seed_docs: {
    zh: "文书员",
    en: "Docs",
    ja: "ドキュメント",
  },
  mem_seed_fixer: {
    zh: "排障员",
    en: "Debugger",
    ja: "デバッガー",
  },
  mem_seed_tester: {
    zh: "测员",
    en: "Tester",
    ja: "テスター",
  },
};

/** True when this id is a built-in catalog seed with Host locale labels. */
export function isCatalogSeedLabelId(id: string): boolean {
  return (
    id === MANAGER_MEMBER_ID
    || id === SUNFLOWER_MEMBER_ID
    || Object.hasOwn(CATALOG_SEED_FORMAL, id)
  );
}

/**
 * Locale formal name for a catalog seed (no nick).
 * Manager → Settings seat title; sunflower → 向日葵 / Sunflower / ひまわり;
 * others → table. `undefined` when not a known catalog seed.
 */
export function catalogSeedFormalName(
  memberId: string,
  locale: SeatTitleLocale,
  seatTitles?: SeatTitles,
): string | undefined {
  if (memberId === MANAGER_MEMBER_ID) {
    return seatTitles?.manager;
  }
  if (memberId === SUNFLOWER_MEMBER_ID) {
    return sunflowerFormalName(locale);
  }
  return CATALOG_SEED_FORMAL[memberId]?.[locale];
}

/**
 * Full chrome label for a catalog seed: formal（nick） when nick applies.
 * Sunflower always uses locked nick `xrkseek` (ignores `nickname`).
 */
export function catalogSeedDisplayLabel(
  memberId: string,
  locale: SeatTitleLocale,
  options?: {
    readonly seatTitles?: SeatTitles;
    readonly nickname?: string;
  },
): string | undefined {
  if (memberId === SUNFLOWER_MEMBER_ID) {
    return sunflowerDisplayLabel(locale);
  }
  const formal = catalogSeedFormalName(
    memberId,
    locale,
    options?.seatTitles,
  );
  if (!formal) return undefined;
  if (memberId === MANAGER_MEMBER_ID) {
    return displayMemberName(formal, options?.nickname);
  }
  return displayMemberName(formal, options?.nickname);
}
