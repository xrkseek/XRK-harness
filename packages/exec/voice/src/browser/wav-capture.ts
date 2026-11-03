/**
 * WAV dictation capture — record in the browser, hand the Host one clip.
 *
 * Both Host STT deliveries we target — an OpenAI-compatible
 * `/audio/transcriptions` and a local sherpa SenseVoice build — take 16 kHz
 * mono PCM WAV, so the clip is decoded and resampled here instead of shipping
 * whatever container the recorder happened to produce: one capture format,
 * two backends, no ffmpeg on either side. (DSH's composer does the same; see
 * `.tmp/dsh-asr-tts-audit.md`.)
 *
 * Capture is a plain `MediaRecorder`: no worklet to load, it works on every
 * browser the composer already supports, and {@link MAX_RECORDING_MS} bounds a
 * stuck press so a forgotten stop cannot grow into an unbounded upload.
 *
 * `packages/exec/voice` compiles WITHOUT `lib.dom` on purpose (its Node entry
 * must never reach for a browser global), so the handful of members this
 * module touches are declared locally in {@link WavDom}. The encoding half —
 * {@link toPcm16} / {@link encodeWav} / {@link toBase64} — is pure and takes
 * no DOM at all.
 */

/** Bounded take; the recorder stops itself and transcribes what it has. */
export const MAX_RECORDING_MS = 120_000

/** Rate every target backend accepts. */
const TARGET_SAMPLE_RATE = 16_000

/** One finished dictation take. */
export interface CapturedClip {
  /** Base64 PCM WAV, no `data:` prefix. */
  readonly audio: string
  readonly mimeType: "audio/wav"
  readonly filename: string
  /** Wall-clock length of the decoded take (diagnostics / empty checks). */
  readonly durationMs: number
}

/** A live take: exactly one of {@link stop} / {@link cancel} settles it. */
export interface VoiceCapture {
  /** Stop the recorder, release the microphone, and resolve the encoded clip. */
  stop(): Promise<CapturedClip>
  /** Stop and discard without decoding (Escape / unmount). */
  cancel(): void
}

interface TrackLike {
  stop(): void
  readonly label?: string
}
interface StreamLike {
  getTracks(): readonly TrackLike[]
  getAudioTracks?(): readonly TrackLike[]
}
interface DecodedAudio {
  readonly duration: number
  getChannelData(channel: number): Float32Array
}
interface DecoderLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<DecodedAudio>
  close(): Promise<void>
}
interface SourceLike {
  buffer: unknown
  connect(target: unknown): void
  start(): void
}
interface OfflineLike {
  readonly destination: unknown
  createBufferSource(): SourceLike
  startRendering(): Promise<DecodedAudio>
}
interface RecorderLike {
  readonly state: string
  readonly mimeType: string
  addEventListener(type: string, listener: (event: { readonly data: Blob }) => void): void
  start(): void
  stop(): void
}

/**
 * The DOM surface this module needs, narrowed to the members it actually calls.
 * Keeping it here rather than enabling `lib.dom` keeps the Node entry honest.
 */
interface WavDom {
  readonly AudioContext?: new () => DecoderLike
  readonly webkitAudioContext?: new () => DecoderLike
  readonly OfflineAudioContext: new (
    channels: number,
    frames: number,
    sampleRate: number,
  ) => OfflineLike
  readonly MediaRecorder: new (stream: StreamLike) => RecorderLike
  readonly navigator?: {
    readonly mediaDevices?: {
      getUserMedia(constraints: object): Promise<StreamLike>
      enumerateDevices?(): Promise<readonly InputDevice[]>
    }
  }
  readonly matchMedia?: (query: string) => { readonly matches: boolean }
  readonly setTimeout: (handler: () => void, timeout: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

/** One `audioinput` entry from `enumerateDevices`. */
interface InputDevice {
  readonly kind: string
  readonly deviceId: string
  readonly label: string
}

function dom(): WavDom {
  return globalThis as unknown as WavDom
}

/**
 * Whether this browser should show a dictation seat at all.
 *
 * Two independent reasons to stay quiet, both decided at render time:
 *
 * - **No capture API**. `navigator.mediaDevices.getUserMedia` exists only in a
 *   secure context, so a phone reaching the Host over plain `http://<lan-ip>`
 *   would render a button whose every press fails. Deciding this at render
 *   time is why the seat never appears on that device.
 * - **Touch-only device**. Phones and tablets are where the transcript cost is
 *   highest and where this path has not been exercised; the seat stays off
 *   there until that case is designed for, rather than shipped half-tested.
 *
 * Deliberately not memoised: `matchMedia` is a synchronous property read, and
 * a module-level cache would leak one test's environment into the next.
 */
export function dictationAvailable(): boolean {
  const env = dom()
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== "function") return false
  if (typeof env.matchMedia === "function") {
    const coarse = env.matchMedia("(pointer: coarse)").matches
    const fine = env.matchMedia("(pointer: fine)").matches
    // A touchscreen laptop reports both; only a touch-*only* device is blocked.
    if (coarse && !fine) return false
  }
  return true
}

/**
 * Labels of inputs that are virtual or aggregate and therefore carry silence.
 *
 * A machine with the Steam client, an NVIDIA HDMI path, or a VB-Audio cable
 * exposes several `audioinput` entries that open successfully and record zeros
 * — indistinguishable from a broken recogniser once the clip reaches the Host.
 * Measured here: the browser picked such an input while the OS default (a real
 * USB microphone) was fine, so every take arrived silent.
 */
const VIRTUAL_INPUT = /steam|virtual|vb-audio|voicemeeter|obs|sound ?mapper|stereo ?mix|立体声混音|回放|wave out/i

/**
 * Pick a concrete physical input, falling back to the system default.
 *
 * `enumerateDevices` only exposes labels after the page holds a capture
 * permission, so the caller must have opened (and closed) one stream first.
 * The `default` / `communications` aliases are skipped because they resolve
 * back to whatever the OS — not this picker — considers default.
 * @param devices - Every media device the page can see.
 * @returns Device id to pin, or undefined to keep the OS default.
 */
export function pickPhysicalInput(
  devices: readonly InputDevice[],
): string | undefined {
  const inputs = devices.filter((device) => device.kind === "audioinput")
  const physical = inputs.filter(
    (device) =>
      device.deviceId !== "default" &&
      device.deviceId !== "communications" &&
      device.label !== "" &&
      !VIRTUAL_INPUT.test(device.label),
  )
  return physical[0]?.deviceId
}

/** Begin a take; resolves once the microphone is actually open. */
export async function startVoiceCapture(): Promise<VoiceCapture> {
  const env = dom()
  const media = env.navigator?.mediaDevices
  if (media === undefined || typeof media.getUserMedia !== "function") {
    throw new Error("this browser cannot record audio (no navigator.mediaDevices)")
  }
  if (typeof env.MediaRecorder !== "function") {
    throw new Error("this browser cannot record audio (no MediaRecorder)")
  }
  // Open the OS default first.
  //
  // Two separate reasons the default must not be trusted blindly:
  //   - labels only appear once the page holds a capture permission, so the
  //     picker below needs a live stream to look at;
  //   - a machine running Steam / NVIDIA / VB-Audio exposes virtual inputs
  //     that open successfully and record pure zeros. Measured here: the
  //     browser picked such an input while the OS default (a real USB mic)
  //     worked, and all seven takes arrived silent.
  // Forcing `echoCancellation` / `noiseSuppression` / `autoGainControl` is a
  // third way to be handed silence by a driver, so none of them is requested.
  const probe = await media.getUserMedia({ audio: true })
  const currentLabel = probe.getAudioTracks?.()[0]?.label ?? ""
  let pin: string | undefined
  if (currentLabel === "" || VIRTUAL_INPUT.test(currentLabel)) {
    try {
      pin = pickPhysicalInput((await media.enumerateDevices?.()) ?? [])
    } catch {
      pin = undefined
    }
  }
  let stream = probe
  if (pin !== undefined) {
    for (const track of probe.getTracks()) track.stop()
    stream = await media.getUserMedia({ audio: { deviceId: { exact: pin } } })
  }
  const recorder = new env.MediaRecorder(stream)
  const chunks: Blob[] = []
  let settled = false
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => {
      resolve()
    })
  })
  const release = (): void => {
    for (const track of stream.getTracks()) track.stop()
  }
  recorder.start()
  const timer = env.setTimeout(() => {
    if (recorder.state === "recording") recorder.stop()
  }, MAX_RECORDING_MS)

  const halt = (): void => {
    env.clearTimeout(timer)
    if (recorder.state !== "inactive") recorder.stop()
  }

  return {
    async stop() {
      if (settled) throw new Error("voice capture already settled")
      settled = true
      halt()
      await stopped
      release()
      const blob = new Blob(chunks, {
        type: recorder.mimeType === "" ? "audio/webm" : recorder.mimeType,
      })
      return await encodeClip(blob)
    },
    cancel() {
      if (settled) return
      settled = true
      halt()
      release()
    },
  }
}

/** Decode the recorded container and re-encode it as one 16 kHz mono WAV. */
async function encodeClip(blob: Blob): Promise<CapturedClip> {
  const env = dom()
  const raw = new Uint8Array(await blob.arrayBuffer())
  const Ctor = env.AudioContext ?? env.webkitAudioContext
  if (Ctor === undefined) {
    throw new Error("this browser cannot decode recorded audio (no AudioContext)")
  }
  const decoder = new Ctor()
  let decoded: DecodedAudio
  try {
    // decodeAudioData detaches the buffer it is handed, so pass a copy.
    decoded = await decoder.decodeAudioData(raw.slice().buffer)
  } finally {
    void decoder.close().catch(() => undefined)
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
  const resampler = new env.OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = resampler.createBufferSource()
  source.buffer = decoded
  source.connect(resampler.destination)
  source.start()
  // A mono destination downmixes a stereo take; the rate change is the point.
  const rendered = await resampler.startRendering()
  const pcm = toPcm16(rendered.getChannelData(0))
  // A silent take must not travel: the model would answer with a stray
  // character, which reads as broken recognition rather than a dead capture.
  if (isSilent(pcm)) {
    throw new Error(
      "no sound was captured — check the system microphone (muted, wrong input device, or held by another app)",
    )
  }
  const wav = encodeWav(pcm)
  return {
    audio: toBase64(wav),
    mimeType: "audio/wav",
    filename: "dictation.wav",
    durationMs: Math.round(decoded.duration * 1000),
  }
}

/** Float samples → signed 16-bit PCM (clamped, never wrapping). */
export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0
    const clamped = Math.max(-1, Math.min(1, sample))
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return pcm
}

/**
 * Whether every sample is zero.
 *
 * A take can be seconds long and still carry nothing: the recorder opened, the
 * driver answered, and the processing chain emitted zeros. @see startVoiceCapture.
 * @param pcm - Decoded clip.
 * @returns True when no sample carries any amplitude.
 */
export function isSilent(pcm: Int16Array): boolean {
  for (let i = 0; i < pcm.length; i += 1) {
    if (pcm[i] !== 0) return false
  }
  return true
}

/** Canonical 44-byte RIFF header + PCM body at {@link TARGET_SAMPLE_RATE}. */
export function encodeWav(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + pcm.length * 2, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true)
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, "data")
  view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, pcm[i] ?? 0, true)
  return bytes
}

/** `btoa` over a typed array in chunks (spreading 100k+ args overflows). */
export function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}
