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
| `local` / SenseVoice | 本地 STT：`{XRK_HOME}/voice/sensevoice`（或 `XRK_VOICE_SENSEVOICE_DIR`）放 `model.int8.onnx`/`model.onnx` + `tokens.txt` + `silero_vad.onnx`；Host 需 `sherpa-onnx-node`。TTS 用内存 stub；live 不可用 |
| `1` / openai | 需 `OPENAI_API_KEY` 或 Credentials `XRK_VOICE_OPENAI_KEY`；可选 Settings / `XRK_VOICE_BASE_URL` |

**本机资源准备（一键）**：Settings → Plugins → Voice 选 `local` 后，卡片读 `voice.inspect` 报告缺哪些文件，点「下载并准备」由 Host 取三个资产（`hf-mirror.com` 优先、`huggingface.co` 兜底）：边下边算 SHA-256、`.part` 原子落盘、可取消、可重试。资产不入仓（约 230 MB），revision / sha256 / 字节数钉死在 `packages/exec/voice/src/sensevoice-assets.ts`。

**下载代理（可选）**：上游 302 落到 `cas-bridge.xethub.hf.co`，在部分过滤网络上这层 CDN 不响应 Node 的 TLS 握手（同机 `curl` 却能通）。卡片里的「下载代理」填 `http://127.0.0.1:7897`（Clash / mihomo 的 HTTP 端口）即走 CONNECT 隧道；留空直连；代理本身不通时回落到直连，而不是让整次下载失败。每个源只等 12 秒响应头，之后换下一个源——正文传输不受这个时限约束。

| Face remote             | 作用                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `voice.transcribe`      | 一次性 STT（base64 音频）；未配置时错误码 `voice-unavailable`        |
| `voice.inspect`         | 就绪度：`ready` · 缺哪些文件 · 平台是否支持 · 传输快照               |
| `voice.prepare`         | 开始下载并**立即返回**（传输继续活在 Host 侧）                       |
| `voice.prepareStatus`   | 进度轮询：字节 / 速度 / 阶段 / 失败分类                              |
| `voice.prepareCancel`   | 取消并释放 `.part`                                                   |

传输不绑面板生命周期：关掉设置再打开，卡片接着读同一份快照。Silero 分段工作进程仍按 DSH 实验包语义补齐。

**唤醒词**：未交付。对标 Hermes `wake_word` / on-device hotword 的产品化放在 Voice Settings 开关与缺钥诚实失败稳定之后；当前请用按住说话（browser transport）或产品壳麦克风。

## 客户端麦克风传输（`@xrkseek/exec-voice/browser`）

麦克风只在**浏览器**里打开；Host 只 broker 会话、跑 STT/TTS，音频**不经 Host**（WebRTC 点对点）。

| 能力             | 入口                                               | 说明                                               |
| ---------------- | -------------------------------------------------- | -------------------------------------------------- |
| 能力探测         | `createBrowserVoiceTransport(deps).capabilities()` | `dictation` / `session` 是否可用                   |
| 按住说话（听写） | `dictate()` · `openDictation()`                    | 采集 → `bytes` + base64，直接喂 `voice_transcribe` |
| realtime 会话    | `session({ broker })`                              | 本地 SDP offer → Host broker → 应用 answer         |

**录音设备**：默认输入若命中虚拟设备（Steam Streaming Microphone / NVIDIA Virtual / VB-Audio / 立体声混音等），会改选第一个物理输入。这类设备能正常打开、能"录音"，但整段样本全是 0——录出来的静音和"识别坏了"在 Host 侧完全无法区分。录音结束后若样本全为 0，直接报「没录到声音」，静音不再送进模型。

**语言**：本机 SenseVoice 默认按中文（`zh`）解码。`auto` 自动检测在短促或带噪的普通话上会把语言判错（实测回出韩文单字），只有调用方显式传 `auto` 才走自动检测。

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
| `local` / SenseVoice | Local STT: place `model.int8.onnx`/`model.onnx` + `tokens.txt` + `silero_vad.onnx` under `{XRK_HOME}/voice/sensevoice` (or `XRK_VOICE_SENSEVOICE_DIR`); Host needs `sherpa-onnx-node`. TTS uses memory stub; live unsupported |
| `1` / openai | Needs `OPENAI_API_KEY` or Credentials `XRK_VOICE_OPENAI_KEY`; optional Settings / `XRK_VOICE_BASE_URL` |

**Local asset preparation (one press)**: after the Voice card is set to `local`, it reads `voice.inspect`, lists what is missing, and 「Download and prepare」 makes the Host fetch three assets (`hf-mirror.com` first, `huggingface.co` as fallback): SHA-256 computed while streaming, `.part` written atomically, cancellable and retryable. Assets stay out of the repo (~230 MB); revision / sha256 / byte counts are pinned in `packages/exec/voice/src/sensevoice-assets.ts`.

**Download proxy (optional)**: the upstream 302 lands on `cas-bridge.xethub.hf.co`, and on some filtered networks that CDN never completes a TLS handshake from Node — while `curl` on the same machine succeeds. Put `http://127.0.0.1:7897` (the Clash / mihomo HTTP port) in the card's 「Download proxy」 field to tunnel through it; leave it empty for a direct connection, and a proxy that cannot carry the hop falls back to direct instead of failing the transfer. Each origin gets 12 s to answer with headers before the next one is tried; the body transfer is not bound by that deadline.

| Face remote             | Role                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `voice.transcribe`      | One-shot STT (base64 audio); `voice-unavailable` when unconfigured    |
| `voice.inspect`         | Readiness: `ready` · missing files · platform support · transfer state |
| `voice.prepare`         | Start the download and **return immediately** (it keeps running)      |
| `voice.prepareStatus`   | Progress poll: bytes / speed / phase / failure class                  |
| `voice.prepareCancel`   | Abort and drop the `.part` file                                       |

The transfer is not bound to the panel: close Settings and reopen it, and the card resumes reading the same snapshot. The Silero worker process still follows the DSH experimental package.

**Wake word**: not shipped. Hermes-style on-device hotword comes after Settings Voice switches and missing-key honesty are stable; use push-to-talk (browser transport) or the product-shell mic for now.

## Browser mic transport (`@xrkseek/exec-voice/browser`)

The mic opens **in the browser** only; the Host brokers sessions and runs STT/TTS — audio **never transits the Host** (WebRTC is peer-to-peer).

| Capability       | Entry                                              | Notes                                                           |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Capability probe | `createBrowserVoiceTransport(deps).capabilities()` | whether `dictation` / `session` are available                   |
| Push-to-talk     | `dictate()` · `openDictation()`                    | capture → `bytes` + base64, feed straight to `voice_transcribe` |
| Realtime session | `session({ broker })`                              | local SDP offer → Host broker → apply answer                    |

**Input device**: when the default input is a virtual one (Steam Streaming Microphone, NVIDIA Virtual, VB-Audio, stereo mix…), the capture switches to the first physical input. Those devices open fine and "record" fine, but every sample is 0 — and a silent clip is indistinguishable from a broken recogniser once it reaches the Host. A take whose samples are all zero now fails with 「nothing captured」 instead of being sent to the model.

**Language**: local SenseVoice decodes as Chinese (`zh`) by default. `auto` detection mislabels short or noisy mandarin (observed: a one-character Korean reply), so automatic detection only runs when a caller passes `auto` explicitly.

`broker` is the Host `voice_session` endpoint: it must return an `sdpAnswer` for this transport to finish negotiation; a client-secret-only answer (provider-direct mode) raises `VOICE_LIVE_UNSUPPORTED` — negotiate directly with the provider instead.

Every dependency is injected via `BrowserVoiceDeps` (`getUserMedia` · `MediaRecorder` · `PeerConnection` · `btoa`), so the package needs no DOM lib and is unit-testable with fakes. Missing APIs (insecure context / SSR) → `VOICE_UNAVAILABLE`; a denied mic → `VOICE_BACKEND`.
