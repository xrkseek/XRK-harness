/**
 * SenseVoice ONNX asset lock — the single place a model URL, size, or hash is written.
 *
 * Assets never live in the repo (≈230 MB): a user opts in by pressing download
 * in Settings → Plugins → Voice. Every entry pins a **commit revision** (never
 * `main`) plus a sha256, so a mirror either serves those exact bytes or fails
 * loudly — it cannot silently swap weights.
 *
 * v1 ships int8 only. The fp32 build is 894 MiB (≈4×) for a quality difference
 * nobody has measured here; it stays out until someone does.
 *
 * Third-party provenance — these are NOT first-party weights, and the docs say so:
 *   - `model.int8.onnx` / `tokens.txt`: csukuangfj's sherpa-onnx conversion of
 *     FunAudioLLM/SenseVoice (upstream MIT).
 *   - `silero_vad.onnx`: snakers4/silero-vad via csukuangfj/vad (upstream MIT).
 * Origins: hf-mirror.com first — the direct host black-holes TCP on filtered
 * links and cost the first 20 s of every press — with huggingface.co as the
 * fallback for networks where the mirror is the slower of the two. A Host
 * behind a proxy can be pointed through it from the ASR card (`downloadProxy`).
 */

/** One downloadable file, resolved as `origin + path`. */
export interface SenseVoiceAsset {
  /** Stable id used by the prepare state and the logs. */
  readonly id: string
  /** Basename inside the data root (`{XRK_HOME}/voice/sensevoice`). */
  readonly file: string
  /** Appended to an origin; carries the pinned revision. */
  readonly path: string
  /** Exact byte length — a longer body is a failure, not a bigger model. */
  readonly bytes: number
  readonly sha256: string
}

const REVISION = '2365baeacb507f821a0c8120fcee3d484dba7a07'
const VAD_REVISION = 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc'
const SENSEVOICE_DIR = '/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve'

/**
 * Ordered origins; the preparer walks them in this order and stops at the first
 * that serves bytes.
 *
 * Mainland-first: `hf-mirror.com` is Hugging Face's reverse proxy and answers
 * in ≈1 s on a link where `huggingface.co` does not answer at all (the direct
 * host times out at the TCP layer, which used to burn the first 20 s of every
 * press before the fallback was even tried). The order is only a preference —
 * `XRK_SENSEVOICE_ORIGIN` still lets an operator pin one origin.
 */
export const SENSEVOICE_ORIGINS: readonly string[] = [
  'https://hf-mirror.com',
  'https://huggingface.co',
]

/** Files a ready local engine needs, in download order (smallest first). */
export const SENSEVOICE_ASSETS: readonly SenseVoiceAsset[] = [
  {
    id: 'tokens',
    file: 'tokens.txt',
    path: `${SENSEVOICE_DIR}/${REVISION}/tokens.txt`,
    bytes: 315_894,
    sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
  },
  {
    id: 'vad',
    file: 'silero_vad.onnx',
    path: `/csukuangfj/vad/resolve/${VAD_REVISION}/silero_vad.onnx`,
    bytes: 1_807_522,
    sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
  },
  {
    id: 'model',
    file: 'model.int8.onnx',
    path: `${SENSEVOICE_DIR}/${REVISION}/model.int8.onnx`,
    bytes: 239_233_841,
    sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
  },
]

/** Total download size a user is agreeing to. */
export const SENSEVOICE_TOTAL_BYTES = SENSEVOICE_ASSETS.reduce(
  (sum, asset) => sum + asset.bytes,
  0,
)
