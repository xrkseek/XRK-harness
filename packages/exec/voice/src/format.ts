export const VOICE_PROMPT_TEXT = [
  "Voice (Host):",
  "- `text_to_speech` speaks text via the Host TTS Provider (returns audio meta; does not play on the server).",
  "- `voice_transcribe` runs one-shot STT on base64 audio (dictation / message audio).",
  "- `voice_session` creates a realtime voice session broker (ephemeral client secret / stub SDP); mic/speaker stay on the client. Mode is Host-side, not a Face child turn.",
  "- Without `XRK_VOICE=1` (OpenAI key) or `XRK_VOICE=memory`, tools stay visible and fail honestly.",
].join("\n");
