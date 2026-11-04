/**
 * `<tts_available>` — tells the agent it can speak.
 *
 * Injected on the same seats the Host mounts `text_to_speech` on: a person is
 * listening on 老板's own sessions (project or 干员 agent-home), and nobody is
 * listening on delegated children or background turns. Without this note the
 * model sees the tool but not the intent, so a TTS-enabled chat stays silent
 * until someone explicitly asks for audio.
 *
 * The note also says the clip is an aside, not a turn terminator — reading one
 * line aloud must not end the answer.
 *
 * 中文：只在挂着 text_to_speech 的座位上注入；告诉模型可以顺手播报，念完继续把话说完。
 */
import type { FaceRuntime } from "./context.js";

/** Settings rows the note needs (all optional — a bare tts section is valid). */
function readTtsSettings(runtime: FaceRuntime): {
  readonly enabled: boolean;
  readonly engine: string;
  readonly language: string;
  readonly voiceZh: string;
  readonly voiceEn: string;
} {
  const ns = runtime.settingsNamespaces.view("tts").value as Record<
    string,
    unknown
  >;
  const text = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";
  return {
    enabled: ns.enabled === true,
    engine: text(ns.engine) || "edge",
    language: text(ns.language) || "auto",
    voiceZh: text(ns.voice),
    voiceEn: text(ns.voiceEn),
  };
}

/**
 * True when this session is a delegated child working for another agent. Those
 * seats carry no `text_to_speech` (no listener), so they must not be told it is
 * available. UI forks keep the parent's tools, so they stay speakable.
 */
function isDelegatedChild(runtime: FaceRuntime, sessionId: string): boolean {
  const link = runtime.subagents.getByChild(sessionId);
  return link !== undefined && link.mode !== "fork";
}

/** Human-readable engine label used inside the note. */
function engineLabel(engine: string): string {
  if (engine === "local") return "本机系统语音";
  if (engine === "openai") return "OpenAI 兼容端点";
  return "Edge 在线神经音色";
}

/**
 * Build the `<tts_available>` fragment provider.
 * @param runtime - Face runtime (settings + subagent lineage).
 */
export function createTtsAvailabilityFragmentProvider(runtime: FaceRuntime): {
  readonly id: "tts-available";
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
    id: "tts-available",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const tts = readTtsSettings(runtime);
      if (!tts.enabled) return [];
      if (isDelegatedChild(runtime, sessionId)) return [];
      const voices = [
        tts.voiceZh !== "" ? `中文音色 \`${tts.voiceZh}\`` : null,
        tts.voiceEn !== "" ? `英文音色 \`${tts.voiceEn}\`` : null,
      ].filter((row): row is string => row !== null);
      const body = [
        `用户开着语音播报（引擎：${engineLabel(tts.engine)}；默认语言：${tts.language}${voices.length > 0 ? `；${voices.join("，")}` : ""}）。`,
        "需要让用户「听见」时调用 `text_to_speech`：结论、提醒、一句话确认都适合；大段代码、表格、文件路径不适合念。",
        "播报是辅助——调用后继续把你的话说完，不要因为念了一段就停下。",
      ].join("\n");
      return [
        {
          id: "additional_context.tts_available",
          kind: "additional_context",
          text: `<tts_available>\n${body}\n</tts_available>`,
          phase: "turn-start",
          // After seat identity (7.6); availability is a capability note, not
          // a persona row.
          priority: 7.4,
        },
      ];
    },
  };
}
