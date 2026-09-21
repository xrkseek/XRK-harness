/**
 * Structural views of the browser media APIs the transport touches.
 *
 * The Host package compiles with `lib: ["ES2022"]` (no DOM), and mic/speaker
 * stay on the client — so instead of `lib.dom` we declare the narrow shapes we
 * actually call. That keeps the Node entry free of DOM references and lets the
 * transport be unit-tested with plain fakes.
 */

export interface VoiceAudioTrack {
  stop(): void;
}

export interface VoiceMediaStream {
  getTracks(): readonly VoiceAudioTrack[];
}

export interface MicConstraints {
  readonly audio: true;
}

export type GetUserMedia = (constraints: MicConstraints) => Promise<VoiceMediaStream>;

/** Minimal `Blob` view — only what a recorder chunk needs. */
export interface VoiceBlob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface VoiceRecorderEvent {
  readonly data: VoiceBlob;
}

export interface VoiceMediaRecorder {
  readonly mimeType: string;
  readonly state: string;
  ondataavailable: ((event: VoiceRecorderEvent) => void) | null;
  onstop: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface VoiceMediaRecorderCtor {
  new (
    stream: VoiceMediaStream,
    options?: { readonly mimeType?: string },
  ): VoiceMediaRecorder;
  /** Declared as a function-typed property (not a method) so it can be detached. */
  readonly isTypeSupported?: (mimeType: string) => boolean;
}

export interface VoiceSessionDescription {
  readonly type: string;
  readonly sdp?: string;
}

export interface VoicePeerConnection {
  readonly connectionState?: string;
  readonly localDescription?: VoiceSessionDescription | null;
  onconnectionstatechange: ((event?: unknown) => void) | null;
  addTrack(track: unknown, stream?: VoiceMediaStream): unknown;
  createOffer(): Promise<VoiceSessionDescription>;
  setLocalDescription(description: VoiceSessionDescription): Promise<void>;
  setRemoteDescription(description: VoiceSessionDescription): Promise<void>;
  close(): void;
}

export interface VoicePeerConnectionCtor {
  new (config?: unknown): VoicePeerConnection;
}

/** Injectable browser capabilities; unset values fall back to real globals. */
export interface BrowserVoiceDeps {
  readonly getUserMedia?: GetUserMedia;
  readonly MediaRecorder?: VoiceMediaRecorderCtor;
  readonly PeerConnection?: VoicePeerConnectionCtor;
  /** Passed straight to the `RTCPeerConnection` constructor (e.g. ICE servers). */
  readonly peerConnectionConfig?: unknown;
  /** Injectable Base64 encoder (`btoa`); unset falls back to the global. */
  readonly btoa?: (data: string) => string;
}

/**
 * Host-side session broker: the client posts its local SDP offer and receives
 * the negotiated answer. Wire this to the `voice_session` tool / Host route so
 * the provider key never reaches the browser.
 */
export interface VoiceSessionBrokerRequest {
  readonly sdpOffer: string;
  readonly instructions?: string;
  readonly voice?: string;
  readonly model?: string;
}

export interface VoiceSessionBrokerResult {
  readonly sessionId: string;
  readonly provider?: string;
  readonly sdpAnswer?: string;
  /** Ephemeral provider secret when the provider has no SDP relay. */
  readonly clientSecret?: string;
  readonly note?: string;
}

export type VoiceSessionBroker = (
  request: VoiceSessionBrokerRequest,
) => Promise<VoiceSessionBrokerResult>;
