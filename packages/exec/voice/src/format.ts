/**
 * Prompt blocks for the voice tools.
 *
 * Split by switch so an agent never reads about a tool that is not bound:
 * `tts.enabled` owns `text_to_speech`, `asr.enabled` owns transcription and
 * the live session. `voicePromptText` picks the blocks that actually exist on
 * the surface.
 */

export const VOICE_TTS_PROMPT_TEXT = [
  "- `text_to_speech` speaks text via the Host TTS Provider (returns audio meta; does not play on the server).",
].join("\n");

export const VOICE_ASR_PROMPT_TEXT = [
  "- `voice_transcribe` runs one-shot STT on base64 audio (dictation / message audio).",
  "- `voice_session` creates a realtime voice session broker (ephemeral client secret / stub SDP); mic/speaker stay on the client. Mode is Host-side, not a Face child turn.",
].join("\n");

/** Both blocks — for callers that show voice as one subject. */
export const VOICE_PROMPT_TEXT = ["Voice (Host):", VOICE_TTS_PROMPT_TEXT, VOICE_ASR_PROMPT_TEXT].join(
  "\n",
);

/** The blocks whose tools are actually on this surface; empty when none are. */
export function voicePromptText(has: (name: string) => boolean): string {
  const blocks: string[] = [];
  if (has("text_to_speech")) blocks.push(VOICE_TTS_PROMPT_TEXT);
  if (has("voice_transcribe") || has("voice_session")) blocks.push(VOICE_ASR_PROMPT_TEXT);
  return blocks.length === 0 ? "" : ["Voice (Host):", ...blocks].join("\n");
}
