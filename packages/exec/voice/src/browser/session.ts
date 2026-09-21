/**
 * Realtime voice session bootstrap, browser side.
 *
 * The browser opens the mic, builds a local SDP offer and hands it to a Host
 * *broker* (the `voice_session` tool / Host route). The provider key stays on
 * the Host; only the negotiated answer comes back. Media never transits the
 * Host — audio flows peer-to-peer over WebRTC.
 */
import { VoiceError } from "../types.js";
import {
  micError,
  releaseStream,
  resolveGetUserMedia,
  resolvePeerConnection,
} from "./env.js";
import type {
  BrowserVoiceDeps,
  VoiceMediaStream,
  VoicePeerConnection,
  VoiceSessionBroker,
  VoiceSessionDescription,
} from "./types.js";

export interface VoiceSessionHandle {
  readonly sessionId: string;
  readonly provider?: string;
  readonly note?: string;
  /** Live `RTCPeerConnection.connectionState` (e.g. `connected`). */
  connectionState(): string;
  /** Release the mic and close the peer connection. */
  stop(): void;
}

export interface StartVoiceSessionOptions {
  readonly broker: VoiceSessionBroker;
  readonly deps?: BrowserVoiceDeps;
  readonly instructions?: string;
  readonly voice?: string;
  readonly model?: string;
  readonly onStateChange?: (state: string) => void;
}

/**
 * Open a realtime session. Rejects with a coded `VoiceError` when the mic is
 * unavailable, the broker fails, or the broker answers with only an ephemeral
 * provider secret (which this transport cannot complete without an SDP relay).
 * On every failure path the mic is released and the peer connection closed.
 */
export async function startVoiceSession(
  options: StartVoiceSessionOptions,
): Promise<VoiceSessionHandle> {
  const deps = options.deps ?? {};
  const getUserMedia = resolveGetUserMedia(deps);
  const PeerConnection = resolvePeerConnection(deps);

  let stream: VoiceMediaStream;
  try {
    stream = await getUserMedia({ audio: true });
  } catch (err) {
    throw micError(err);
  }

  let pc: VoicePeerConnection | undefined;
  try {
    const connection = new PeerConnection(deps.peerConnectionConfig);
    pc = connection;
    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }
    const notify = options.onStateChange;
    if (notify) {
      connection.onconnectionstatechange = () =>
        notify(connection.connectionState ?? "unknown");
    }

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const sdpOffer = connection.localDescription?.sdp ?? offer.sdp ?? "";
    if (!sdpOffer) {
      throw new VoiceError("the browser produced an empty SDP offer", "VOICE_BACKEND");
    }

    const brokered = await options.broker({
      sdpOffer,
      ...(options.instructions !== undefined
        ? { instructions: options.instructions }
        : {}),
      ...(options.voice !== undefined ? { voice: options.voice } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
    });

    if (brokered.sdpAnswer) {
      const answer: VoiceSessionDescription = {
        type: "answer",
        sdp: brokered.sdpAnswer,
      };
      await connection.setRemoteDescription(answer);
    } else if (brokered.clientSecret) {
      throw new VoiceError(
        "the provider answered with an ephemeral client secret, not an SDP answer; " +
          "this transport needs a Host SDP relay — complete WebRTC directly against " +
          "the provider endpoint if you cannot broker an answer",
        "VOICE_LIVE_UNSUPPORTED",
      );
    } else {
      throw new VoiceError(
        "voice session broker returned neither an SDP answer nor a client secret",
        "VOICE_BACKEND",
      );
    }

    return {
      sessionId: brokered.sessionId,
      ...(brokered.provider !== undefined ? { provider: brokered.provider } : {}),
      ...(brokered.note !== undefined ? { note: brokered.note } : {}),
      connectionState: () => connection.connectionState ?? "unknown",
      stop(): void {
        connection.onconnectionstatechange = null;
        releaseStream(stream);
        try {
          connection.close();
        } catch {
          // Closing an already-closed connection is not an error.
        }
      },
    };
  } catch (err) {
    try {
      pc?.close();
    } catch {
      // The original failure is what matters.
    }
    releaseStream(stream);
    throw err;
  }
}
