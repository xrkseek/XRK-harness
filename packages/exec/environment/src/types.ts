/**
 * Pluggable execution world (Hermes TerminalEnvironmentProvider subset for XRK).
 *
 * Replaces fs + subprocess for one session (like SSH `SshExecutionWorld`).
 * **Not** `SandboxService.confine` (same-world argv isolation) and **not**
 * docker/bwrap backends inside `createSandboxStack`.
 */

import type { FsService } from "@xrkseek/exec-fs";
import type { SubprocessService } from "@xrkseek/exec-subprocess";

/** One live execution world bound to a workspace root. */
export interface ExecWorld {
  readonly workspaceRoot: string;
  readonly fs: FsService;
  readonly subprocess: SubprocessService;
  dispose(): void;
}

/**
 * Named backend that can mint an {@link ExecWorld}.
 * Mirrors Hermes `TerminalEnvironmentProvider` + MemoryProvider discovery.
 */
export interface ExecEnvironmentProvider {
  /** Stable id (`local` · `http` · plugin name). */
  readonly providerName: string;
  /** Probe before wiring (Hermes `is_available`). */
  isAvailable(): boolean | Promise<boolean>;
  /** Build fs + subprocess for one agent workspace. */
  createWorld(options: {
    readonly workspaceRoot: string;
    readonly signal?: AbortSignal;
  }): ExecWorld | Promise<ExecWorld>;
}

export type ExecEnvironmentKind = "local" | "http";
