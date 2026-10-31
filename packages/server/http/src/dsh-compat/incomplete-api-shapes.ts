/**
 * Path-prefix → minimal JSON when no earlier dsh-compat / Cordis handler claimed
 * the route. Keyed by **HTTP wire shape**, not npm package id (community packs
 * republish under arbitrary scopes).
 *
 * Prefer staging + Host apply so these bodies are never hit. They only stop
 * Settings Slot-crashes (hard `.filter` / `.map` on missing arrays). They are
 * **not** a substitute for a real Cordis / dsh-compat handler — the plugin is
 * not usable on this path.
 */

export type IncompleteApiShape = {
  readonly prefix: string;
  readonly body: (
    route: string,
  ) => Record<string, unknown> | undefined;
};

const OFM_PREFIX = "/api/our-free-model";

const OFM_NOTE =
  "Cordis host half missing or not applied for this API prefix — restage host files and restart Host.";

/** Wire-shape registry. Add rows when a community panel hard-requires arrays. */
export const INCOMPLETE_COMMUNITY_API_SHAPES: readonly IncompleteApiShape[] = [
  {
    prefix: OFM_PREFIX,
    body(route) {
      if (route === "/summary" || route === "/" || route === "") {
        return {
          catalog: [],
          settings: { enabled: true, hiddenModelIds: [] },
          laneAvailable: false,
          channels: { state: "unavailable", error: OFM_NOTE },
          announcements: { unread: 0, fetchedAt: 0 },
          update: { available: false, managed: true },
          eacAuth: null,
          probedAt: 0,
          note: OFM_NOTE,
        };
      }
      if (route === "/stats") {
        // OFM 2.7.x Dashboard does `[...stats.days]` / `stats.models` — missing
        // arrays crash the Settings slot even when Host half is incomplete.
        return {
          requests: 0,
          requestFailures: 0,
          turns: 0,
          failedTurns: 0,
          recoveredTurns: 0,
          days: [],
          models: [],
          samples: [],
          savings: { percent: 0, summary: "" },
          grand: {
            input: 0,
            output: 0,
            reasoning: 0,
            calls: 0,
            failed: 0,
            turns: 0,
            failedTurns: 0,
            recoveredTurns: 0,
          },
          note: OFM_NOTE,
        };
      }
      if (route === "/eac/status") {
        return {
          available: false,
          authorized: false,
          login: "",
          note: OFM_NOTE,
        };
      }
      return undefined;
    },
  },
];

/**
 * @returns shaped body for an unclaimed community API path, or `undefined`
 * to fall through to the generic incomplete envelope.
 */
export function incompleteCommunityApiBody(
  pathname: string,
): Record<string, unknown> | undefined {
  for (const row of INCOMPLETE_COMMUNITY_API_SHAPES) {
    if (
      pathname !== row.prefix &&
      !pathname.startsWith(`${row.prefix}/`)
    ) {
      continue;
    }
    const route = pathname.slice(row.prefix.length) || "/";
    const body = row.body(route);
    if (body) return body;
  }
  return undefined;
}
