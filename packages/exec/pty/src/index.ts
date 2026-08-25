import { createBashTerminalBackend } from "./backend.js";
import { defaultPtyBackendConfig, type PtyBackendConfig } from "./config.js";
import { spawnNodePtyTerminal, type SpawnTerminalFn } from "./handle.js";
import { createTerminalSessionService } from "./registry.js";
import type { DisposableTerminalSessionService } from "./types.js";

export {
  TerminalBackendCleanupError,
  TerminalError,
  isTerminalError,
  type DisposableTerminalSessionService,
  type SubprocessTerminalHandle,
  type TerminalBackend,
  type TerminalBackendSession,
  type TerminalBackendSpawnSpec,
  type TerminalErrorCode,
  type TerminalForeground,
  type TerminalOutcome,
  type TerminalReadRequest,
  type TerminalReadResult,
  type TerminalSendOperation,
  type TerminalSendRead,
  type TerminalSendRequest,
  type TerminalSendResult,
  type TerminalSessionService,
  type TerminalSessionSnapshot,
  type TerminalSessionStatus,
  type TerminalSignal,
  type TerminalSignalResult,
  type TerminalSpawnRequest,
  type TerminalSpawnResult,
  type TerminalWaitReason,
} from "./types.js";
export {
  defaultPtyBackendConfig,
  validatePtyBackendConfig,
  type PtyBackendConfig,
} from "./config.js";
export { resolvePtyShell } from "./resolve-shell.js";
export {
  DSH_ENV_PREFIX,
  SENSITIVE_ENV_PATTERN,
  XRK_ENV_PREFIX,
  childEnv,
  scrubbedParentEnv,
} from "./env.js";
export {
  CONTROLLED_PROMPT,
  PROMPT_MARKER_PREFIX,
  TerminalSanitizer,
  normalizeTerminalText,
} from "./sanitize.js";
export { LocalPtySession } from "./session.js";
export {
  createProcessInspector,
  linuxProcessGroupHasLiveMembers,
  parseProcStat,
  type ProcessIdentity,
  type ProcessInspector,
  type ProcessInspectorInternals,
} from "./process-inspector.js";
export {
  LocalTerminalHandle,
  liveTerminalCount,
  releaseLiveTerminal,
  spawnNodePtyTerminal,
  type SpawnTerminalFn,
  type SpawnTerminalSpec,
} from "./handle.js";
export { createTerminalSessionService, unknownSessionHint } from "./registry.js";
export {
  createBashTerminalBackend,
  type BashTerminalBackendOptions,
} from "./backend.js";
export { resolvePtyCwd } from "./cwd.js";
export {
  DEFAULT_MAX_RESULT_BYTES,
  MIN_MAX_RESULT_BYTES,
  PTY_PROMPT_TEXT,
  boundTerminalText,
  presentOpenCall,
  presentSendCall,
  presentSendResult,
  renderList,
  renderRead,
  renderSend,
  renderSendRead,
  renderSpawn,
} from "./render.js";
export {
  PTY_TOOL_NAMES,
  TERMINAL_SIGNALS,
  createPtyTools,
  ptyUnavailableMessage,
  type CreatePtyToolsOptions,
  type PtyBackgroundJobs,
} from "./tools.js";

export {
  sandboxModeChangeBlockedMessage,
  type PtySandboxMode,
  type SandboxModeFenceCheck,
} from "./sandbox-fence.js";

export interface DefaultPtyAccessOptions {
  readonly workspaceRoot: string;
  readonly spawnTerminal?: SpawnTerminalFn;
  readonly config?: Partial<PtyBackendConfig>;
  readonly wrapArgv?: (
    argv: readonly string[],
    cwd?: string,
  ) => readonly string[];
}

export interface DefaultPtyAccess {
  readonly workspaceRoot: string;
  readonly service: DisposableTerminalSessionService;
}

/** Composition-scoped bash PTY registry. Spawn fails honestly without node-pty. */
export function createDefaultPtyAccess(
  options: DefaultPtyAccessOptions,
): DefaultPtyAccess {
  const config = defaultPtyBackendConfig(options.config ?? {});
  const service = createTerminalSessionService();
  service.registerBackend(
    createBashTerminalBackend({
      config,
      workspaceRoot: options.workspaceRoot,
      spawnTerminal: options.spawnTerminal ?? spawnNodePtyTerminal,
      ...(options.wrapArgv ? { wrapArgv: options.wrapArgv } : {}),
    }),
  );
  return { workspaceRoot: options.workspaceRoot, service };
}
