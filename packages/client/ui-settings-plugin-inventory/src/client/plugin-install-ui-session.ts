/**
 * Durable plugin CLI mutate UI session for Settings → Plugins → All.
 * Survives Settings modal unmount so an in-flight TerminalBlock / post-mutate
 * refresh hint is still there when the user comes back.
 * Shared by install and update so both get busy + live log + chase spinner.
 */

/** Settled CLI mutate log for Settings TerminalBlock (install / update). */
export type PluginInstallLog = {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number;
};

/** Which CLI mutate started the current / last success session. */
export type PluginMutateKind = "install" | "update";

export type PluginInstallUiState = {
  readonly busy: boolean;
  /** Spec shown while busy / on the TerminalBlock before settle. */
  readonly activeSpec: string;
  /** Last successfully completed spec (toast / list refresh). */
  readonly okSpec: string;
  /** Mutate kind for toast copy after busy→ok. */
  readonly kind: PluginMutateKind | null;
  readonly log: PluginInstallLog | null;
  readonly error: string | null;
  readonly success: boolean;
  /** Persist until page reload (or explicit clear). */
  readonly clientRefreshHint: boolean;
};

const EMPTY: PluginInstallUiState = {
  busy: false,
  activeSpec: "",
  okSpec: "",
  kind: null,
  log: null,
  error: null,
  success: false,
  clientRefreshHint: false,
};

let state: PluginInstallUiState = EMPTY;
const listeners = new Set<() => void>();
let logUnsub: (() => void) | undefined;
let runGeneration = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(next: Partial<PluginInstallUiState>): void {
  state = { ...state, ...next };
  emit();
}

/** Subscribe to install UI changes (useSyncExternalStore). */
export function subscribePluginInstallUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPluginInstallUiSnapshot(): PluginInstallUiState {
  return state;
}

/** Mark that the product shell needs a client-half refresh (install / enable / …). */
export function markPluginClientRefreshHint(): void {
  if (state.clientRefreshHint) return;
  patch({ clientRefreshHint: true });
}

/** Clear settled log / success when the user edits the install field (not mid-run). */
export function clearPluginInstallSettledUi(): void {
  if (state.busy) return;
  if (
    state.log === null &&
    state.error === null &&
    state.success === false &&
    state.activeSpec === "" &&
    state.kind === null
  ) {
    return;
  }
  patch({
    log: null,
    error: null,
    success: false,
    activeSpec: "",
    okSpec: "",
    kind: null,
  });
}

/** Show a settled CLI mutate log without a success toast (legacy / remove). */
export function setPluginMutateLog(log: PluginInstallLog): void {
  if (state.busy) return;
  patch({
    log,
    error: null,
    success: false,
    activeSpec: "",
    okSpec: "",
    kind: null,
    clientRefreshHint: true,
  });
}

/** Validation / soft errors that do not start a Host mutate. */
export function setPluginInstallUiError(message: string): void {
  if (state.busy) return;
  patch({
    error: message,
    success: false,
  });
}

export type RunPluginCliMutateUiOptions = {
  readonly kind: PluginMutateKind;
  /** Display / toast name (package id or short title). */
  readonly spec: string;
  /** Prompt line shown on the TerminalBlock while streaming. */
  readonly command: string;
  readonly run: (requestId: string) => Promise<PluginInstallLog>;
  readonly subscribeInstallLog?: (
    requestId: string,
    onText: (text: string) => void,
  ) => () => void;
  /** When the thrown value is not an Error. */
  readonly fallbackError?: string;
};

function logFromError(
  error: unknown,
  command: string,
): PluginInstallLog | null {
  if (error !== null && typeof error === "object" && "installLog" in error) {
    const log = (error as { installLog?: unknown }).installLog;
    if (
      log !== null &&
      typeof log === "object" &&
      typeof (log as PluginInstallLog).command === "string" &&
      typeof (log as PluginInstallLog).output === "string" &&
      typeof (log as PluginInstallLog).exitCode === "number"
    ) {
      return log as PluginInstallLog;
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return {
      command,
      output: error.message,
      exitCode: 1,
    };
  }
  return null;
}

/**
 * Start (or no-op if already busy) a CLI mutate. Log streaming continues after
 * Settings unmount until settle.
 */
export async function runPluginCliMutateUi(
  options: RunPluginCliMutateUiOptions,
): Promise<void> {
  const spec = options.spec.trim();
  if (!spec || state.busy) return;

  const generation = ++runGeneration;
  logUnsub?.();
  logUnsub = undefined;

  const command = options.command.trim() || `xrkh plugin add ${spec}`;
  const requestId = `${options.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  patch({
    busy: true,
    kind: options.kind,
    activeSpec: spec,
    okSpec: "",
    error: null,
    success: false,
    log: { command, output: "", exitCode: 0 },
  });

  logUnsub = options.subscribeInstallLog?.(requestId, (text) => {
    if (generation !== runGeneration) return;
    const prev = getPluginInstallUiSnapshot().log;
    patch({
      log:
        prev === null
          ? { command, output: text, exitCode: 0 }
          : { ...prev, output: prev.output + text },
    });
  });

  try {
    const log = await options.run(requestId);
    if (generation !== runGeneration) return;
    patch({
      log,
      success: true,
      okSpec: spec,
      kind: options.kind,
      clientRefreshHint: true,
      busy: false,
      activeSpec: "",
      error: null,
    });
  } catch (error) {
    if (generation !== runGeneration) return;
    const prev = getPluginInstallUiSnapshot().log;
    const fromError = logFromError(error, command);
    let nextLog = prev;
    if (fromError !== null) {
      nextLog =
        prev !== null &&
        prev.output.length > 0 &&
        fromError.output.length <= prev.output.length
          ? { ...fromError, output: prev.output, exitCode: 1 }
          : fromError;
    }
    patch({
      log: nextLog,
      error:
        error instanceof Error
          ? error.message
          : (options.fallbackError ?? "action failed"),
      success: false,
      busy: false,
    });
  } finally {
    if (generation === runGeneration) {
      logUnsub?.();
      logUnsub = undefined;
      if (getPluginInstallUiSnapshot().busy) {
        patch({ busy: false });
      }
    }
  }
}

export type RunPluginInstallUiOptions = {
  readonly spec: string;
  readonly registry?: string;
  readonly install: (
    spec: string,
    registry?: string,
    requestId?: string,
  ) => Promise<PluginInstallLog>;
  readonly subscribeInstallLog?: (
    requestId: string,
    onText: (text: string) => void,
  ) => () => void;
  readonly fallbackError?: string;
};

/** Install wrapper over {@link runPluginCliMutateUi}. */
export async function runPluginInstallUi(
  options: RunPluginInstallUiOptions,
): Promise<void> {
  const spec = options.spec.trim();
  if (!spec) return;
  const command = options.registry
    ? `xrkh plugin add --registry ${options.registry} ${spec}`
    : `xrkh plugin add ${spec}`;
  await runPluginCliMutateUi({
    kind: "install",
    spec,
    command,
    run: (requestId) => options.install(spec, options.registry, requestId),
    ...(options.subscribeInstallLog !== undefined
      ? { subscribeInstallLog: options.subscribeInstallLog }
      : {}),
    ...(options.fallbackError !== undefined
      ? { fallbackError: options.fallbackError }
      : {}),
  });
}

/** Test-only reset. */
export function resetPluginInstallUiSessionForTests(): void {
  runGeneration += 1;
  logUnsub?.();
  logUnsub = undefined;
  state = EMPTY;
  emit();
}
