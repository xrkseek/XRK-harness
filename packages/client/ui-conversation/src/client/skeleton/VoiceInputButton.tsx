/**
 * Composer dictation seat — the button immediately left of send/stop.
 *
 * Press to record, press again to transcribe. The transcript goes in through
 * the shell's `paste`, the same path a clipboard paste takes, so reference
 * placeholders are sanitized and caret/undo behave exactly like typing.
 * Capture, decode and the 16 kHz mono WAV resample all happen in the browser
 * (`@xrkseek/exec-voice/capture`); the Host receives one clip and is the only
 * side that holds a Provider credential.
 *
 * The seat stays visible when dictation cannot run, because a device where
 * the user simply has not switched dictation on yet should show a way to fix
 * that rather than vanish. A refusal the user can act on (`voice-unavailable`
 * — mode off, no key, local engine not prepared) turns the seat into a
 * Settings entry: the first press opens the Voice card and clears the state,
 * the next press records again, so a fixed configuration takes effect without
 * a reload. Backend failures stay as a tooltip and retry in place.
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import clsx from "clsx";
import { Tooltip } from "@xrkseek/client-ui-primitives";
// The WAV capture lives on the voice package's browser entry so the Settings
// card's 「试一句」 and this button record through one implementation.
import { dictationAvailable, startVoiceCapture, type VoiceCapture } from "@xrkseek/exec-voice/capture";
import type { ConversationKey } from "../locales.ts";
import css from "./InputBar.module.css";

/** Sub-200 ms taps are almost always a mis-click, not speech. */
const MIN_TAKE_MS = 200;

/** The Host's code for 「dictation is not configured at all」. */
const VOICE_UNAVAILABLE = "voice-unavailable";

type Phase = "idle" | "starting" | "recording" | "transcribing";

/** A refusal worth showing, and whether Settings is where it gets fixed. */
interface Refusal {
  /** The Host's own sentence: it names what to switch on. */
  readonly text: string
  /** True when pressing the seat should open Settings instead of recording. */
  readonly actionable: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Host's structured refusal code, when the rejection carries one. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export interface VoiceInputButtonProps {
  /** Session-removed lock (the bar's chrome disable state). */
  readonly locked: boolean
  /** Host dictation callback; absent with the session. */
  readonly transcribeVoice: ((audio: string, mimeType: string) => Promise<string>) | undefined
  /** Settings trip for an unconfigured Host; absent without the Settings shell. */
  readonly openVoiceSettings: (() => void) | undefined
  /** Insert the transcript at the caret (reference-placeholder-sanitized). */
  readonly paste: (text: string) => void
  /** The bar's own "keep the editor focused on mouse press" handler. */
  readonly keepFocus: (event: MouseEvent<HTMLButtonElement>) => void
  readonly t: (key: ConversationKey) => string
}

export function VoiceInputButton({
  locked, transcribeVoice, openVoiceSettings, paste, keepFocus, t,
}: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const captureRef = useRef<VoiceCapture | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    captureRef.current?.cancel();
    captureRef.current = null;
  }, []);

  const settle = (message: string | undefined, code?: string): void => {
    if (!mountedRef.current) return;
    // Only offer the Settings trip when there is a Settings shell to open;
    // otherwise the reason stays a tooltip rather than a dead button.
    const actionable = code === VOICE_UNAVAILABLE && openVoiceSettings !== undefined;
    setRefusal(message === undefined ? undefined : { text: message, actionable });
    setPhase("idle");
  };

  const begin = async (): Promise<void> => {
    if (transcribeVoice === undefined) return;
    setRefusal(undefined);
    setPhase("starting");
    let capture: VoiceCapture;
    try {
      capture = await startVoiceCapture();
    } catch (error: unknown) {
      settle(messageOf(error), codeOf(error));
      return;
    }
    if (!mountedRef.current) {
      capture.cancel();
      return;
    }
    captureRef.current = capture;
    setPhase("recording");
  };

  const finish = async (): Promise<void> => {
    const capture = captureRef.current;
    if (capture === null || transcribeVoice === undefined) return;
    captureRef.current = null;
    setPhase("transcribing");
    try {
      const clip = await capture.stop();
      if (clip.durationMs < MIN_TAKE_MS) {
        settle(t("input.voice.empty"));
        return;
      }
      const text = (await transcribeVoice(clip.audio, clip.mimeType)).trim();
      if (!mountedRef.current) return;
      if (text === "") {
        settle(t("input.voice.empty"));
        return;
      }
      paste(text);
      settle(undefined);
    } catch (error: unknown) {
      settle(messageOf(error), codeOf(error));
    }
  };

  const press = (): void => {
    if (phase === "recording") {
      void finish();
      return;
    }
    if (refusal?.actionable === true) {
      // One press opens Settings and clears the refusal; the next press
      // records, so a fixed configuration needs no reload to take effect.
      setRefusal(undefined);
      openVoiceSettings?.();
      return;
    }
    void begin();
  };

  const usable = transcribeVoice !== undefined && !locked;
  const busy = phase === "starting" || phase === "transcribing";
  const recording = phase === "recording";
  const needsSetup = refusal?.actionable === true;
  // Two gates. No session ⇒ no Host to transcribe with, so a bare skeleton
  // (tests, hostless previews) keeps its row free of a button that could never
  // do anything. And the device must be one where capture can actually work:
  // a phone on plain `http://<lan-ip>` has no `getUserMedia` at all, so the
  // seat is not drawn there rather than drawn and failing on press.
  if (transcribeVoice === undefined || !dictationAvailable()) return null;
  // The Host's own failure text is left untranslated on purpose: it names a
  // backend/mode the user fixes in Settings, and rewriting it hides that.
  const label = refusal?.text
    ?? (recording
      ? t("input.voice.stop")
      : phase === "transcribing"
        ? t("input.voice.transcribing")
        : t("input.voice"));

  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        className={clsx(css.primary, recording && css.recording, needsSetup && css.needsSetup)}
        aria-label={needsSetup ? t("input.voice.setup") : label}
        aria-pressed={recording}
        aria-busy={busy}
        aria-haspopup={needsSetup ? "dialog" : undefined}
        disabled={!usable || busy}
        onMouseDown={keepFocus}
        onClick={press}
      >
        {recording ? (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <rect x="5.6" y="1.6" width="4.8" height="8" rx="2.4" fill="currentColor" />
            <path
              d="M3.6 7.2a4.4 4.4 0 0 0 8.8 0M8 11.6V14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </Tooltip>
  );
}
