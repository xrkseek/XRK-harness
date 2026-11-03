/**
 * System TTS — the Host machine's own voices (Windows SAPI · macOS `say` ·
 * Linux `espeak-ng`).
 *
 * The Host cannot reach the user's speaker, but it *can* render a WAV and hand
 * the bytes back to the client, which plays them like any other Provider's
 * audio. "Local" therefore means "installed on the Host", not "no model
 * download" — and it costs nothing when the platform already ships a voice.
 *
 * Every backend is one external command driven through `execFile`; the text
 * goes through a temp file instead of argv so quotes, newlines and CJK survive
 * the shell boundary. A missing binary is a `VOICE_BACKEND` error naming the
 * package to install, never a silent empty clip.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  VoiceLiveCreateRequest,
  VoiceLiveCreateResult,
  VoiceLiveStatus,
  VoiceService,
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from "./types.js";
import { VoiceError } from "./types.js";

/** One voice the Host's OS can speak with. */
export interface SystemVoice {
  /** Value a card writes into `tts.voice`. */
  readonly id: string
  /** Human label, usually `Name (locale)`. */
  readonly label: string
}

/** How one system backend is driven. */
export interface SystemVoiceOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Defaults to `process.platform`; a test seam. */
  readonly platform?: NodeJS.Platform;
  /** Voice selected when a request carries none. */
  readonly defaultVoice?: string;
  /** Test seam: run one command and resolve stdout. */
  readonly run?: SystemRunner;
}

/** `execFile` with the flags every backend needs. */
type SystemRunner = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<string>;

/** Longest text one clip may carry (argv/env limits are not the constraint, patience is). */
const MAX_TEXT = 8_000;

function runCommand(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { env, timeout: 60_000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

/** PowerShell 5.1 is present on every supported Windows; `pwsh` is not. */
const POWERSHELL = "powershell.exe";

/**
 * SAPI synthesis script. Text and output paths ride the environment so the
 * encoded script carries no user data at all.
 */
const SAPI_SYNTH = [
  "Add-Type -AssemblyName System.Speech",
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
  "$VOICE = $env:XRK_TTS_VOICE",
  "if ($VOICE) { try { $s.SelectVoice($VOICE) } catch {} }",
  "$s.SetOutputToWaveFile($env:XRK_TTS_OUT)",
  "$s.Speak([IO.File]::ReadAllText($env:XRK_TTS_TEXT, [Text.Encoding]::UTF8))",
  "$s.Dispose()",
].join("; ");

const SAPI_VOICES = [
  "Add-Type -AssemblyName System.Speech",
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
  "$rows = $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {",
  "  [PSCustomObject]@{ id = $_.VoiceInfo.Name; label = ($_.VoiceInfo.Name + ' (' + $_.VoiceInfo.Culture.Name + ')') }",
  "}",
  "$s.Dispose()",
  "$rows | ConvertTo-Json -Compress",
].join("; ");

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

interface RawVoice {
  readonly id?: unknown;
  readonly label?: unknown;
}

function parseVoiceRows(raw: string): SystemVoice[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const rows: readonly RawVoice[] = Array.isArray(parsed)
    ? (parsed as RawVoice[])
    : [parsed as RawVoice];
  const voices: SystemVoice[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.trim() === "") continue;
    const label = typeof row.label === "string" && row.label.trim() !== ""
      ? row.label.trim()
      : row.id.trim();
    voices.push({ id: row.id.trim(), label });
  }
  return voices;
}

/** `say -v '?'` rows: `Name<2+ spaces>locale<2+ spaces># note`. */
function parseSayVoices(raw: string): SystemVoice[] {
  const voices: SystemVoice[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(.+?)\s{2,}(\S+)\s*(?:#.*)?$/.exec(line);
    if (match === null) continue;
    const id = match[1]!.trim();
    const locale = match[2]!.trim();
    if (id === "" || id.toLowerCase() === "name") continue;
    voices.push({ id, label: `${id} (${locale})` });
  }
  return voices;
}

/** `espeak-ng --voices` rows: `Pty Language Age/Gender VoiceName File ...`. */
function parseEspeakVoices(raw: string): SystemVoice[] {
  const voices: SystemVoice[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || /^Pty\s/.test(trimmed)) continue;
    const cols = trimmed.split(/\s{2,}/);
    const id = cols[3]?.trim();
    if (id === undefined || id === "") continue;
    const locale = cols[1]?.trim() ?? "";
    voices.push({ id, label: locale === "" ? id : `${id} (${locale})` });
  }
  return voices;
}

type Backend = "sapi" | "say" | "espeak";

function backendFor(platform: NodeJS.Platform): Backend {
  if (platform === "win32") return "sapi";
  if (platform === "darwin") return "say";
  return "espeak";
}

function missingBackend(backend: Backend): VoiceError {
  const hint = backend === "espeak"
    ? "install espeak-ng (apt install espeak-ng / dnf install espeak-ng)"
    : "this Host platform ships no system speech command";
  return new VoiceError(
    `local TTS is unavailable on this Host — ${hint}`,
    "VOICE_BACKEND",
  );
}

/**
 * List the OS voices this Host can speak with, best-effort.
 *
 * A failed probe returns `[]`: the card still lets the user type a voice name,
 * so an empty list must not read as "local TTS is broken".
 * @param options - platform / env / runner overrides.
 * @returns installed voices, or an empty list when the probe fails.
 */
export async function listSystemVoices(
  options: SystemVoiceOptions = {},
): Promise<SystemVoice[]> {
  const env = options.env ?? process.env;
  const react = options.run ?? runCommand;
  const backend = backendFor(options.platform ?? process.platform);
  try {
    if (backend === "sapi") {
      const stdout = await react(
        POWERSHELL,
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(SAPI_VOICES)],
        env,
      );
      return parseVoiceRows(stdout);
    }
    if (backend === "say") {
      return parseSayVoices(await react("say", ["-v", "?"], env));
    }
    return parseEspeakVoices(await react("espeak-ng", ["--voices"], env));
  } catch {
    return [];
  }
}

/**
 * A {@link VoiceService} that synthesises with the Host's own OS voices.
 *
 * STT and live sessions are deliberately unsupported: this Provider exists to
 * make `text_to_speech` work with zero credentials, nothing else.
 * @param options - platform / env / runner / default-voice overrides.
 * @returns the Provider.
 */
export function createSystemVoiceProvider(
  options: SystemVoiceOptions = {},
): VoiceService {
  const env = options.env ?? process.env;
  const react = options.run ?? runCommand;
  const backend = backendFor(options.platform ?? process.platform);

  return {
    async synthesize(req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> {
      const text = String(req.text ?? "").trim();
      if (text === "") {
        throw new VoiceError("synthesize text is empty", "VOICE_BAD_ARGS");
      }
      if (text.length > MAX_TEXT) {
        throw new VoiceError(
          `text is ${text.length} chars; local TTS accepts up to ${MAX_TEXT}`,
          "VOICE_BAD_ARGS",
        );
      }
      const dir = await mkdtemp(path.join(tmpdir(), "xrk-tts-"));
      const textPath = path.join(dir, "text.txt");
      const audioPath = path.join(dir, "out.wav");
      try {
        await writeFile(textPath, text, "utf8");
        const voice = req.voice?.trim() || options.defaultVoice?.trim() || "";
        if (backend === "sapi") {
          await react(
            POWERSHELL,
            [
              "-NoProfile",
              "-NonInteractive",
              "-EncodedCommand",
              encodePowerShell(SAPI_SYNTH),
            ],
            {
              ...env,
              XRK_TTS_TEXT: textPath,
              XRK_TTS_OUT: audioPath,
              ...(voice === "" ? {} : { XRK_TTS_VOICE: voice }),
            },
          );
        } else if (backend === "say") {
          // LEI16 WAV keeps one mime type across every backend (say's native
          // AIFF is not something every client decodes).
          await react(
            "say",
            [
              ...(voice === "" ? [] : ["-v", voice]),
              "-o",
              audioPath,
              "--data-format=LEI16@22050",
              "-f",
              textPath,
            ],
            env,
          );
        } else {
          await react(
            "espeak-ng",
            [
              "-w",
              audioPath,
              ...(voice === "" ? [] : ["-v", voice]),
              "-f",
              textPath,
            ],
            env,
          );
        }
        const bytes = new Uint8Array(await readFile(audioPath));
        if (bytes.byteLength === 0) {
          throw new VoiceError("local TTS produced an empty clip", "VOICE_BACKEND");
        }
        return {
          bytes,
          mimeType: "audio/wav",
          provider: `system-${backend}`,
          delivery: "system",
          note: `system-tts bytes=${bytes.byteLength} voice=${voice || "default"}`,
        };
      } catch (err) {
        if (err instanceof VoiceError) throw err;
        if (
          typeof err === "object"
          && err !== null
          && "code" in err
          && (err as { code?: unknown }).code === "ENOENT"
        ) {
          throw missingBackend(backend);
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new VoiceError(
          `local TTS (${backend}) failed: ${reason}`,
          "VOICE_BACKEND",
        );
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async transcribe(_req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
      throw new VoiceError(
        "the local TTS Provider does not transcribe; pick an ASR engine",
        "VOICE_UNAVAILABLE",
      );
    },

    async createLiveSession(
      _req: VoiceLiveCreateRequest,
    ): Promise<VoiceLiveCreateResult> {
      throw new VoiceError(
        "the local TTS Provider does not open live sessions",
        "VOICE_LIVE_UNSUPPORTED",
      );
    },

    liveStatus(): VoiceLiveStatus {
      return {
        available: false,
        mode: "none",
        provider: `system-${backend}`,
        reason: "local TTS renders a clip on the Host; it opens no live session",
      };
    },
  };
}
