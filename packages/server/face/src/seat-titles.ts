/**
 * Classic three-tier seat titles for inject + Overview.
 * Live in Settings `ui-presence` — independent of the presence-ball appearance
 * switch. Built-in presets are locale-aware (zh/en/ja); optional
 * `titleBoss` / `titleManager` / `titleAgent` are free-form (any language).
 */

export const SEAT_TITLE_SCHEMES = [
  "office",
  "corp",
  "crew",
  "guild",
] as const;

export type SeatTitleSchemeId = (typeof SEAT_TITLE_SCHEMES)[number];

export type SeatTitleLocale = "zh" | "en" | "ja";

export type SeatTitles = {
  readonly boss: string;
  readonly manager: string;
  readonly agent: string;
};

export const DEFAULT_SEAT_TITLE_SCHEME: SeatTitleSchemeId = "office";
export const SEAT_TITLE_MAX = 24;

const SCHEME_TITLES: Readonly<
  Record<SeatTitleSchemeId, Readonly<Record<SeatTitleLocale, SeatTitles>>>
> = {
  office: {
    zh: { boss: "老板", manager: "经理", agent: "干员" },
    en: { boss: "Boss", manager: "Manager", agent: "Agent" },
    ja: { boss: "ボス", manager: "マネージャー", agent: "エージェント" },
  },
  corp: {
    zh: { boss: "总裁", manager: "主管", agent: "专员" },
    en: { boss: "CEO", manager: "Lead", agent: "Specialist" },
    ja: { boss: "社長", manager: "課長", agent: "担当" },
  },
  crew: {
    zh: { boss: "船长", manager: "大副", agent: "水手" },
    en: { boss: "Captain", manager: "First mate", agent: "Crew" },
    ja: { boss: "船長", manager: "一等航海士", agent: "船員" },
  },
  guild: {
    zh: { boss: "会长", manager: "干部", agent: "成员" },
    en: { boss: "Guild master", manager: "Officer", agent: "Member" },
    ja: { boss: "会長", manager: "幹部", agent: "メンバー" },
  },
};

export function isSeatTitleSchemeId(raw: unknown): raw is SeatTitleSchemeId {
  return (
    typeof raw === "string"
    && (SEAT_TITLE_SCHEMES as readonly string[]).includes(raw)
  );
}

/** Legacy `en` preset → office (English copy comes from locale, not scheme id). */
export function parseSeatTitleScheme(raw: unknown): SeatTitleSchemeId {
  if (raw === "en") return "office";
  return isSeatTitleSchemeId(raw) ? raw : DEFAULT_SEAT_TITLE_SCHEME;
}

export function parseSeatTitleLocale(raw: unknown): SeatTitleLocale {
  return raw === "en" || raw === "ja" ? raw : "zh";
}

export function seatTitlesForScheme(
  scheme: SeatTitleSchemeId,
  locale: SeatTitleLocale = "zh",
): SeatTitles {
  return SCHEME_TITLES[scheme][locale];
}

export function clipSeatTitle(raw: unknown, max = SEAT_TITLE_MAX): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

/**
 * Custom fields win (any language). Empty → built-in preset in the given locale.
 */
export function readSeatTitles(
  presenceUser: Record<string, unknown> | undefined,
  localeRaw?: unknown,
): SeatTitles {
  const locale = parseSeatTitleLocale(localeRaw);
  const defaults = seatTitlesForScheme(
    parseSeatTitleScheme(presenceUser?.titleScheme),
    locale,
  );
  return {
    boss: clipSeatTitle(presenceUser?.titleBoss) || defaults.boss,
    manager: clipSeatTitle(presenceUser?.titleManager) || defaults.manager,
    agent: clipSeatTitle(presenceUser?.titleAgent) || defaults.agent,
  };
}

/** Preference from Settings `locale` namespace (`zh` | `en` | `ja`). */
export function readUiLocalePreference(
  localeUser: Record<string, unknown> | undefined,
): SeatTitleLocale {
  return parseSeatTitleLocale(localeUser?.preference);
}
