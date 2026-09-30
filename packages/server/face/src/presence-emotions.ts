/**
 * Overview presence emotion catalog — same ids as
 * `apps/web/public/presence/emotion-ball/emotions.js` (`EMOTION_SEED`).
 * Tool + standing docs should stay in lockstep with that list.
 */

export type PresenceEmotionGroup = "life" | "emotion" | "agent";

export interface PresenceEmotionEntry {
  readonly id: string;
  readonly group: PresenceEmotionGroup;
  /** Short Chinese label (UI / tips). */
  readonly zh: string;
  /** Short English label (tool description / UI). */
  readonly en: string;
}

/** Full supported set for `presence_set` (and Overview labels). */
export const PRESENCE_EMOTION_CATALOG: readonly PresenceEmotionEntry[] = [
  { id: "00", group: "life", zh: "睡眠", en: "Sleeping" },
  { id: "01", group: "life", zh: "唤醒", en: "Waking" },
  { id: "02", group: "life", zh: "待机", en: "Idle" },
  { id: "03", group: "life", zh: "好奇", en: "Curious" },
  { id: "04", group: "life", zh: "发呆", en: "Spacing out" },
  { id: "05", group: "life", zh: "加载苏醒", en: "Booting" },
  { id: "06", group: "life", zh: "休眠", en: "Dormant" },
  { id: "07", group: "life", zh: "抖动唤醒", en: "Shake awake" },
  { id: "10", group: "emotion", zh: "开心", en: "Happy" },
  { id: "11", group: "emotion", zh: "疑惑", en: "Puzzled" },
  { id: "12", group: "emotion", zh: "失落", en: "Down" },
  { id: "13", group: "emotion", zh: "惊讶", en: "Surprised" },
  { id: "14", group: "emotion", zh: "害羞", en: "Shy" },
  { id: "15", group: "emotion", zh: "疲惫", en: "Tired" },
  { id: "16", group: "emotion", zh: "专注", en: "Focused" },
  { id: "17", group: "emotion", zh: "慌张", en: "Panicked" },
  { id: "18", group: "emotion", zh: "无奈", en: "Resigned" },
  { id: "19", group: "emotion", zh: "满意", en: "Satisfied" },
  { id: "20", group: "emotion", zh: "困惑", en: "Confused" },
  { id: "21", group: "emotion", zh: "生气", en: "Angry" },
  { id: "30", group: "agent", zh: "思考中", en: "Thinking" },
  { id: "31", group: "agent", zh: "接收任务", en: "Receiving" },
  { id: "32", group: "agent", zh: "处理中", en: "Busy" },
  { id: "33", group: "agent", zh: "任务完成", en: "Done" },
  { id: "34", group: "agent", zh: "出错", en: "Error" },
  { id: "35", group: "agent", zh: "等待输入", en: "Listening" },
  { id: "36", group: "agent", zh: "联网加载", en: "Loading" },
  { id: "37", group: "agent", zh: "复述回忆", en: "Recalling" },
  { id: "38", group: "agent", zh: "拒绝/受限", en: "Refusing" },
  { id: "39", group: "agent", zh: "输出回复", en: "Replying" },
  { id: "40", group: "agent", zh: "检索资料", en: "Searching" },
  { id: "41", group: "agent", zh: "停止终止", en: "Powering off" },
] as const;

const BY_ID = new Map(PRESENCE_EMOTION_CATALOG.map((e) => [e.id, e]));

export function isKnownPresenceEmotionId(id: string): boolean {
  return BY_ID.has(id);
}

export function presenceEmotionById(
  id: string,
): PresenceEmotionEntry | undefined {
  return BY_ID.get(id);
}

/** Compact English catalog line for tool descriptions. */
export function formatPresenceEmotionToolHint(): string {
  return PRESENCE_EMOTION_CATALOG.map((e) => `${e.id} ${e.en}`).join("; ");
}
