export type TerminalWaitReason =
  | "stdin_read"
  | "inferred_idle"
  | "timeout"
  | "session_exit";

export type TerminalSignal =
  | "SIGINT"
  | "SIGTERM"
  | "SIGKILL"
  | "SIGTSTP"
  | "SIGHUP";

export type TerminalSessionStatus =
  | { readonly kind: "running" }
  | {
      readonly kind: "exited";
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    };

export interface TerminalSpawnRequest {
  readonly type: string;
  readonly name?: string;
  readonly cwd?: string;
  /** Face / agent session id → child `XRK_SESSION_ID`. */
  readonly ownerSessionId?: string;
}

export interface TerminalSendRequest {
  readonly text: string;
  readonly submit: boolean;
  readonly signal?: AbortSignal;
}

export interface TerminalSendRead {
  readonly delta: string;
  readonly truncated: boolean;
}

export interface TerminalSendResult {
  readonly viewport: string;
  readonly waitReason: TerminalWaitReason;
  readonly sessionStatus: TerminalSessionStatus;
  readonly truncated: boolean;
}

export interface TerminalSendOperation {
  readonly done: Promise<TerminalSendResult>;
  readOutput(): TerminalSendRead;
  cancel(): boolean;
}

export interface TerminalReadRequest {
  readonly offset?: number;
  readonly count?: number;
}

export interface TerminalReadResult {
  readonly text: string;
  readonly totalLines: number;
  readonly lineBegin: number;
  readonly lineEnd: number;
  readonly truncated: boolean;
}

export interface TerminalSignalResult {
  readonly delivered: true;
  readonly targetPgid: number;
}

export interface TerminalSessionSnapshot {
  readonly sessionId: string;
  readonly name?: string;
  readonly type: string;
  readonly pid?: number;
  readonly status: TerminalSessionStatus;
}

export interface TerminalSpawnResult extends TerminalSessionSnapshot {
  readonly motd: string;
}

export interface TerminalForeground {
  readonly processGroupId: number;
  readonly inputWaiting: boolean;
}

export interface TerminalOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SubprocessTerminalHandle {
  readonly pid: number;
  readonly output: NodeJS.ReadableStream;
  readonly done: Promise<TerminalOutcome>;
  write(data: string): Promise<void>;
  inspectForeground(): Promise<TerminalForeground | undefined>;
  signalForeground(signal: TerminalSignal): Promise<number>;
  terminate(): Promise<void>;
}

export interface TerminalBackendSpawnSpec extends TerminalSpawnRequest {
  readonly sessionId: string;
  /** Agent / Face session id for `XRK_SESSION_ID` (optional; composition may omit). */
  readonly ownerSessionId?: string;
  readonly signal?: AbortSignal;
}

export interface TerminalBackendSession {
  readonly motd: string;
  readonly pid?: number;
  startSend(request: TerminalSendRequest): TerminalSendOperation;
  read(request: TerminalReadRequest): TerminalReadResult;
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>;
  status(): TerminalSessionStatus;
  close(reason: string): Promise<void>;
}

export interface TerminalBackend {
  readonly type: string;
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>;
}

export type TerminalErrorCode =
  | "DUPLICATE_BACKEND"
  | "DUPLICATE_NAME"
  | "NO_BACKEND"
  | "NO_SESSION"
  | "NO_PTY"
  | "PTY_PATH"
  | "SEND_ACTIVE"
  | "SERVICE_DISPOSING";

export class TerminalError extends Error {
  readonly code: TerminalErrorCode;
  constructor(message: string, code: TerminalErrorCode) {
    super(message);
    this.name = "TerminalError";
    this.code = code;
  }
}

export function isTerminalError(err: unknown): err is TerminalError {
  return err instanceof TerminalError;
}

export class TerminalBackendCleanupError extends AggregateError {
  constructor(
    readonly spawnError: unknown,
    readonly cleanupError: unknown,
  ) {
    super(
      [spawnError, cleanupError],
      "PTY backend startup and cleanup both failed",
    );
    this.name = "TerminalBackendCleanupError";
  }
}

export interface TerminalSessionService {
  spawn(
    request: TerminalSpawnRequest,
    signal?: AbortSignal,
  ): Promise<TerminalSpawnResult>;
  startSend(
    sessionId: string,
    request: TerminalSendRequest,
  ): TerminalSendOperation;
  read(sessionId: string, request?: TerminalReadRequest): TerminalReadResult;
  signal(
    sessionId: string,
    signal: TerminalSignal,
  ): Promise<TerminalSignalResult>;
  kill(sessionId: string, reason?: string): Promise<boolean>;
  list(): readonly TerminalSessionSnapshot[];
  /**
   * True while any session is published or a spawn is unpublished-in-progress
   * (CV DSH `hasOwnerActivity` without Cordis Agent — composition is the owner).
   */
  hasActivity(): boolean;
  dispose(): Promise<void>;
}

/** Composition-scoped registry: backends + sessions; no Agent / Cordis owner. */
export interface DisposableTerminalSessionService extends TerminalSessionService {
  registerBackend(backend: TerminalBackend): () => void;
  listBackends(): readonly string[];
}
