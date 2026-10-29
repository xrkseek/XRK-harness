/**
 * Shared Boss (operator) mood lives in Settings `ui-presence`.
 *
 * - Turn-start fragment: every employee session (project 经理 · agent-home
 *   identity · orchestrators) sees the live mood even when idle.
 * - On change: steer into sessions that are mid-turn so they notice without
 *   waiting for the next human prompt.
 */

import type { FaceRuntime } from "./context.js";
import {
  DEFAULT_SEAT_TITLE_SCHEME,
  readSeatTitles,
  readUiLocalePreference,
  seatTitlesForScheme,
  type SeatTitles,
} from "./seat-titles.js";

const FALLBACK_BOSS_TITLE = seatTitlesForScheme(DEFAULT_SEAT_TITLE_SCHEME, "zh").boss;

const MOOD_LABEL_ZH: Readonly<Record<string, string>> = {
  "00": "睡眠",
  "03": "好奇",
  "04": "发呆",
  "10": "开心",
  "15": "疲惫",
  "16": "专注",
  "17": "慌张",
  "18": "无奈",
  "19": "满意",
  "21": "生气",
  "30": "思考中",
  "33": "任务完成",
};

export type BossStatusFields = {
  readonly moodId: string;
  readonly statusLine: string;
};

export function readBossStatusFields(
  presenceUser: Record<string, unknown> | undefined,
): BossStatusFields {
  const moodRaw =
    typeof presenceUser?.moodId === "string" ? presenceUser.moodId.trim() : "";
  const moodId = moodRaw || "16";
  const statusLine =
    typeof presenceUser?.statusLine === "string"
      ? presenceUser.statusLine.trim().slice(0, 80)
      : "";
  return { moodId, statusLine };
}

export function bossStatusFingerprint(fields: BossStatusFields): string {
  return `${fields.moodId}\0${fields.statusLine}`;
}

/** User-visible + model-visible notice (steer / chat). */
export function formatBossStatusUserMessage(
  fields: BossStatusFields,
  titles?: SeatTitles,
): string {
  const boss = titles?.boss ?? FALLBACK_BOSS_TITLE;
  const mood = MOOD_LABEL_ZH[fields.moodId] ?? fields.moodId;
  if (fields.statusLine) {
    return `[${boss}状态] ${mood} · ${fields.statusLine}`;
  }
  return `[${boss}状态] ${mood}`;
}

/** Compact turn-start inject body (inside `<boss_status>`). */
export function formatBossStatusInjectBody(
  fields: BossStatusFields,
  titles?: SeatTitles,
): string {
  const mood = MOOD_LABEL_ZH[fields.moodId] ?? fields.moodId;
  const lines = [
    `seat=${titles?.boss ?? FALLBACK_BOSS_TITLE}`,
    `mood=${mood}`,
  ];
  if (fields.statusLine) lines.push(`status=${fields.statusLine}`);
  return lines.join("\n");
}

/**
 * Employee seats that should see Boss mood: project / agent-home / orchestrator
 * parents. Tool-spawned children inherit via parent steer or their own parent
 * turn-start — skip them to avoid nested spam.
 */
export function isBossStatusAudienceSession(
  runtime: FaceRuntime,
  sessionId: string,
): boolean {
  if (!runtime.store.has(sessionId)) return false;
  if (runtime.subagents.getByChild(sessionId)) return false;
  return true;
}

function isSessionTurnRunning(
  runtime: FaceRuntime,
  sessionId: string,
): boolean {
  return runtime.drain.isActive(sessionId) && !runtime.isTurnUiIdle(sessionId);
}

/** Debounce keyed by Host so rapid field-by-field Settings writes coalesce. */
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFingerprint = "";
let lastBroadcastFingerprint = "";

/**
 * After `ui-presence` persists, schedule a mid-turn steer into running
 * employee sessions when mood / statusLine actually changed. Idle sessions
 * pick up the live value from the turn-start fragment on the next prompt.
 */
export function scheduleBossStatusBroadcast(
  runtime: FaceRuntime,
  before: BossStatusFields,
  after: BossStatusFields,
): void {
  const nextFp = bossStatusFingerprint(after);
  if (nextFp === bossStatusFingerprint(before)) return;
  pendingFingerprint = nextFp;
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    const fp = pendingFingerprint;
    if (!fp || fp === lastBroadcastFingerprint) return;
    lastBroadcastFingerprint = fp;
    const presenceUser = runtime.settingsNamespaces.view("ui-presence")
      .value as Record<string, unknown>;
    const fields = readBossStatusFields(presenceUser);
    if (bossStatusFingerprint(fields) !== fp) return;
    void broadcastBossStatusToRunningEmployees(runtime, fields);
  }, 280);
}

export async function broadcastBossStatusToRunningEmployees(
  runtime: FaceRuntime,
  fields: BossStatusFields,
): Promise<number> {
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const text = formatBossStatusUserMessage(
    fields,
    readSeatTitles(presenceUser, readUiLocalePreference(localeUser)),
  );
  const targets = runtime.store
    .list()
    .filter(
      (id) =>
        isBossStatusAudienceSession(runtime, id) && isSessionTurnRunning(runtime, id),
    );
  let sent = 0;
  await Promise.all(
    targets.map(async (sessionId) => {
      try {
        runtime.watchSession(sessionId);
        const agent = await runtime.resolveAgent(sessionId);
        agent.admit(text, { delivery: "steer" });
        runtime.publishQueue(sessionId);
        runtime.drain.wake(sessionId);
        sent += 1;
      } catch {
        /* ignore per-session failures */
      }
    }),
  );
  return sent;
}

/** @deprecated Prefer {@link broadcastBossStatusToRunningEmployees}. */
export const broadcastBossStatusToRunningManagers =
  broadcastBossStatusToRunningEmployees;

/**
 * Turn-start fragment so idle employee sessions still see the current Boss
 * mood without requiring a mid-turn steer.
 */
export function createBossStatusFragmentProvider(runtime: FaceRuntime): {
  readonly id: "boss-status";
  readonly phases: readonly ["turn-start"];
  produce(ctx: { readonly sessionId: string }): readonly {
    readonly id: string;
    readonly kind: "additional_context";
    readonly text: string;
    readonly phase: "turn-start";
    readonly priority: number;
  }[];
} {
  return {
    id: "boss-status",
    phases: ["turn-start"],
    produce({ sessionId }) {
      if (!isBossStatusAudienceSession(runtime, sessionId)) return [];
      const presenceUser = runtime.settingsNamespaces.view("ui-presence")
        .value as Record<string, unknown>;
      const localeUser = runtime.settingsNamespaces.view("locale")
        .value as Record<string, unknown>;
      const fields = readBossStatusFields(presenceUser);
      const titles = readSeatTitles(
        presenceUser,
        readUiLocalePreference(localeUser),
      );
      const body = formatBossStatusInjectBody(fields, titles);
      return [
        {
          id: "additional_context.boss_status",
          kind: "additional_context",
          text: `<boss_status>\n${body}\n</boss_status>`,
          phase: "turn-start",
          // After posture (8.5), ahead of collab board (8).
          priority: 8.2,
        },
      ];
    },
  };
}

/** Test helper — reset debounce / last-broadcast state. */
export function resetBossStatusBroadcastStateForTests(): void {
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  pendingTimer = undefined;
  pendingFingerprint = "";
  lastBroadcastFingerprint = "";
}
