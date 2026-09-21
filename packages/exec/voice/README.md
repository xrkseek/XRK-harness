# @xrkseek/exec-voice

Voice Host seam: TTS · dictation (STT) · realtime voice session broker.

- **Definition**: `VoiceService` (`synthesize` · `transcribe` · `createLiveSession` · `liveStatus`)
- **Provider**: `createMemoryVoiceProvider` · `createOpenAiVoiceProvider` · Host-injected
- **Consumer**: `createVoiceTools` → `text_to_speech` · `voice_transcribe` · `voice_session`

Mic/speaker and WebRTC stay on the client. Tools stay registered when no Provider is configured; execute fails honestly.

Env: `XRK_VOICE=memory` | `XRK_VOICE=1` + `OPENAI_API_KEY` / `XRK_VOICE_OPENAI_KEY`.

## Browser mic transport

`@xrkseek/exec-voice/browser` is the client-side capture seam: DOM-free structural types with every
capability injected through `BrowserVoiceDeps` (`getUserMedia` · `MediaRecorder` · `PeerConnection` · `btoa`).

- `createBrowserVoiceTransport(deps)` → `capabilities()` · `dictate()` / `openDictation()` · `session({ broker })`
- `startDictation` · `dictateOnce` · `pickRecorderMime` · `encodeBase64`
- `startVoiceSession` — local SDP offer → Host broker → answer; `stop()` releases the mic and closes the peer connection

Audio never transits the Host. A denied mic → `VOICE_BACKEND`; a missing API (insecure context / SSR) →
`VOICE_UNAVAILABLE`; a client-secret-only broker answer → `VOICE_LIVE_UNSUPPORTED`.

See [docs/voice.md](../../../docs/voice.md) · [docs/seams.md](../../../docs/seams.md).
