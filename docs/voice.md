# 语音 Host

> **读者**：集成者 · Agent 作者

Host 语音缝：`@xrkseek/exec-voice`。麦克风 / 扬声器 / WebRTC **留在客户端**；本进程提供 TTS · 听写 · realtime session **broker**。

## 工具

| 工具               | 作用                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `text_to_speech`   | TTS；返回 base64 音频元数据（服务端不播放）                                |
| `voice_transcribe` | 一次性 STT（base64 音频）                                                  |
| `voice_session`    | `status` / `create` realtime 会话（OpenAI `client_secret` 或 memory stub） |

## 启用

**产品路径**：Settings → Plugins → **Voice**（Face ns `voice`：`mode` = 关 / openai · 可选 `baseUrl`）。API 密钥经 Credentials `XRK_VOICE_OPENAI_KEY`（不进 settings.yaml）。保存后 Host `invalidateAgents` 热切换。非空 `XRK_VOICE` 为 CI 旁路。

| `XRK_VOICE` / Settings | 行为 |
| ----------- | ------------------------------------------------------------------------ |
| （未设 / 关） | 工具仍登记；execute **诚实失败** |
| `memory`（仅 env） | 内存 Provider（CI / 演示） |
| `1` / openai | 需 `OPENAI_API_KEY` 或 Credentials `XRK_VOICE_OPENAI_KEY`；可选 Settings / `XRK_VOICE_BASE_URL` |

不覆盖本地 faster-whisper / Piper / 原生 voice-host 子进程（Codex 式）；那是后续 Provider。

**唤醒词**：未交付。对标 Hermes `wake_word` / on-device hotword 的产品化放在 Voice Settings 开关与缺钥诚实失败稳定之后；当前请用按住说话（browser transport）或产品壳麦克风。

## 客户端麦克风传输（`@xrkseek/exec-voice/browser`）

麦克风只在**浏览器**里打开；Host 只 broker 会话、跑 STT/TTS，音频**不经 Host**（WebRTC 点对点）。

| 能力             | 入口                                               | 说明                                               |
| ---------------- | -------------------------------------------------- | -------------------------------------------------- |
| 能力探测         | `createBrowserVoiceTransport(deps).capabilities()` | `dictation` / `session` 是否可用                   |
| 按住说话（听写） | `dictate()` · `openDictation()`                    | 采集 → `bytes` + base64，直接喂 `voice_transcribe` |
| realtime 会话    | `session({ broker })`                              | 本地 SDP offer → Host broker → 应用 answer         |

`broker` 即 Host 侧 `voice_session`：返回 `sdpAnswer` 才能在本传输内完成协商；若只返回临时 `clientSecret`（Provider 直连模式）则抛 `VOICE_LIVE_UNSUPPORTED`，需自行直连。

依赖全部经 `BrowserVoiceDeps` 注入（`getUserMedia` · `MediaRecorder` · `PeerConnection` · `btoa`），故本包 `lib` 无需 DOM，且可用假对象单测。缺 API（非安全上下文 / SSR）→ `VOICE_UNAVAILABLE`；用户拒绝麦克风 → `VOICE_BACKEND`。

---

# Voice Host

> **Audience**: Integrators · Agent authors

Host voice seam: `@xrkseek/exec-voice`. Mic / speaker / WebRTC stay **on the client**; this process provides TTS · dictation · realtime session **broker**.

## Tools

| Tool               | Role                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `text_to_speech`   | TTS; returns base64 audio meta (server does not play)                        |
| `voice_transcribe` | One-shot STT (base64 audio)                                                  |
| `voice_session`    | `status` / `create` realtime session (OpenAI `client_secret` or memory stub) |

## Enable

**Product path**: Settings → Plugins → **Voice** (Face ns `voice`: `mode` = off / openai · optional `baseUrl`). API key via Credentials `XRK_VOICE_OPENAI_KEY` (not settings.yaml). After save, Host `invalidateAgents` hot-swaps. Non-empty `XRK_VOICE` is the CI bypass.

| `XRK_VOICE` / Settings | Behavior |
| ----------- | ------------------------------------------------------------------------------- |
| (unset / off) | Tools still register; execute **fails honestly** |
| `memory` (env only) | In-memory Provider (CI / demos) |
| `1` / openai | Needs `OPENAI_API_KEY` or Credentials `XRK_VOICE_OPENAI_KEY`; optional Settings / `XRK_VOICE_BASE_URL` |

Local faster-whisper / Piper / native voice-host subprocess (Codex-style) are out of MVP — add as later Providers.

**Wake word**: not shipped. Hermes-style on-device hotword comes after Settings Voice switches and missing-key honesty are stable; use push-to-talk (browser transport) or the product-shell mic for now.

## Browser mic transport (`@xrkseek/exec-voice/browser`)

The mic opens **in the browser** only; the Host brokers sessions and runs STT/TTS — audio **never transits the Host** (WebRTC is peer-to-peer).

| Capability       | Entry                                              | Notes                                                           |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Capability probe | `createBrowserVoiceTransport(deps).capabilities()` | whether `dictation` / `session` are available                   |
| Push-to-talk     | `dictate()` · `openDictation()`                    | capture → `bytes` + base64, feed straight to `voice_transcribe` |
| Realtime session | `session({ broker })`                              | local SDP offer → Host broker → apply answer                    |

`broker` is the Host `voice_session` endpoint: it must return an `sdpAnswer` for this transport to finish negotiation; a client-secret-only answer (provider-direct mode) raises `VOICE_LIVE_UNSUPPORTED` — negotiate directly with the provider instead.

Every dependency is injected via `BrowserVoiceDeps` (`getUserMedia` · `MediaRecorder` · `PeerConnection` · `btoa`), so the package needs no DOM lib and is unit-testable with fakes. Missing APIs (insecure context / SSR) → `VOICE_UNAVAILABLE`; a denied mic → `VOICE_BACKEND`.
