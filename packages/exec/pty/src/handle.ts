import { Buffer } from "node:buffer";
import { constants } from "node:os";
import { PassThrough } from "node:stream";
import { childEnv } from "./env.js";
import {
  createProcessInspector,
  type ProcessIdentity,
  type ProcessInspector,
} from "./process-inspector.js";
import { withResolvers } from "./defer.js";
import {
  TerminalError,
  type SubprocessTerminalHandle,
  type TerminalForeground,
  type TerminalOutcome,
  type TerminalSignal,
} from "./types.js";

/** Live PTY handles for synchronous host-exit finalization (CV DSH subprocess-local). */
const liveTerminals = new Set<LocalTerminalHandle>();
let hostExitHookInstalled = false;

function ensureHostExitHook(): void {
  if (hostExitHookInstalled) return;
  hostExitHookInstalled = true;
  process.prependListener("exit", () => {
    for (const terminal of liveTerminals) {
      try {
        terminal.terminateForHostExit();
      } catch {
        // One terminal must not prevent final termination of another.
      }
    }
  });
}

/** Test / dispose hook: drop a handle from the host-exit live set. */
export function releaseLiveTerminal(handle: LocalTerminalHandle): void {
  liveTerminals.delete(handle);
}

/** Test hook: how many terminals are registered for host-exit cleanup. */
export function liveTerminalCount(): number {
  return liveTerminals.size;
}

interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
}

export interface SpawnTerminalSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly rows: number;
  readonly cols: number;
  readonly graceMs: number;
  readonly signal?: AbortSignal;
}

export type SpawnTerminalFn = (
  spec: SpawnTerminalSpec,
) => Promise<SubprocessTerminalHandle>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalName(number: number | undefined): NodeJS.Signals | null {
  if (number === undefined || number === 0) return null;
  for (const [name, value] of Object.entries(constants.signals)) {
    if (value === number) return name as NodeJS.Signals;
  }
  return null;
}

/**
 * Local terminal handle (CV from DSH `subprocess-local` LocalTerminalHandle).
 * Process-session ownership stays below the PTY backend session.
 */
export class LocalTerminalHandle implements SubprocessTerminalHandle {
  readonly pid: number;
  readonly output = new PassThrough();
  readonly done: Promise<TerminalOutcome>;

  private readonly outcome = withResolvers<TerminalOutcome>();
  private readonly dataDisposable: { dispose(): void };
  private readonly exitDisposable: { dispose(): void };
  private cleanup: Promise<void> | undefined;
  private exited = false;
  private trackedDescendants: ProcessIdentity[] = [];
  private readonly rootIdentity: ProcessIdentity | undefined;

  constructor(
    private readonly terminal: PtyProcess,
    private readonly inspector: ProcessInspector,
    private readonly graceMs: number,
  ) {
    this.pid = terminal.pid;
    this.rootIdentity = inspector
      .processTree(this.pid)
      .find((member) => member.pid === this.pid);
    this.done = this.outcome.promise;
    ensureHostExitHook();
    liveTerminals.add(this);
    void this.done.finally(() => {
      liveTerminals.delete(this);
    });
    this.dataDisposable = terminal.onData((data) => {
      this.output.write(Buffer.from(data, "utf8"));
    });
    this.exitDisposable = terminal.onExit(({ exitCode, signal: exitSignal }) => {
      if (this.exited) return;
      this.exited = true;
      this.output.end();
      this.outcome.resolve({
        exitCode:
          exitSignal === undefined || exitSignal === 0 ? exitCode : null,
        signal: signalName(exitSignal),
      });
    });
  }

  async write(data: string): Promise<void> {
    if (this.exited) throw new Error("terminal process has exited");
    this.terminal.write(data);
  }

  async inspectForeground(): Promise<TerminalForeground | undefined> {
    this.descendants();
    const processGroupId = this.inspector.foregroundPgid(this.pid);
    if (processGroupId === undefined) return undefined;
    return {
      processGroupId,
      inputWaiting: this.inspector.isStdinWaiting(processGroupId),
    };
  }

  async signalForeground(signal: TerminalSignal): Promise<number> {
    const foreground = await this.inspectForeground();
    if (foreground === undefined) {
      throw new Error(
        `cannot resolve foreground process group for terminal ${this.pid}`,
      );
    }
    if (signal === "SIGKILL" && foreground.processGroupId === this.pid) {
      throw new Error(
        "refusing to SIGKILL the terminal shell; terminate the terminal session instead",
      );
    }
    this.inspector.signalGroup(foreground.processGroupId, signal);
    return foreground.processGroupId;
  }

  terminate(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup;
    const cleanup = this.closeOnce();
    this.cleanup = cleanup;
    void cleanup.catch(() => {
      this.cleanup = undefined;
    });
    return cleanup;
  }

  /** Sync best-effort stop for host `exit` — does not replace terminate(). */
  terminateForHostExit(): void {
    this.forceStopDescendants();
    this.forceStopShell();
    this.forceStopDescendants();
  }

  private forceStopShell(): void {
    if (this.exited) return;
    if (this.rootIdentity !== undefined) {
      try {
        this.inspector.signalProcess(this.rootIdentity, "SIGKILL");
      } catch {
        // Exact identity signalling contains both exit races and PID reuse.
      }
      return;
    }
    try {
      this.terminal.kill("SIGKILL");
    } catch {
      // Without a captured identity, node-pty is the only root kill primitive.
    }
  }

  private survivors(members: ProcessIdentity[]): ProcessIdentity[] {
    return members.filter((member) => this.inspector.isAlive(member));
  }

  private descendants(): ProcessIdentity[] {
    const tree = this.inspector.processTree(this.pid);
    const root = tree.find((member) => member.pid === this.pid);
    const rootVerified =
      this.rootIdentity !== undefined &&
      root !== undefined &&
      root.started === this.rootIdentity.started;
    this.trackedDescendants = this.survivors(
      this.unionMembers(
        this.trackedDescendants,
        ...(rootVerified
          ? [tree, this.inspector.processSession(this.pid)]
          : []),
      ).filter((member) => member.pid !== this.pid),
    );
    return this.trackedDescendants;
  }

  private async waitForMembers(
    members: ProcessIdentity[],
  ): Promise<ProcessIdentity[]> {
    const until = Date.now() + this.graceMs;
    let survivors = this.survivors(members);
    while (survivors.length > 0 && Date.now() < until) {
      await delay(Math.min(25, Math.max(1, until - Date.now())));
      survivors = this.survivors(members);
    }
    return survivors;
  }

  private signalMembers(
    members: ProcessIdentity[],
    signal: "SIGTERM" | "SIGKILL",
  ): void {
    for (const member of members) {
      try {
        this.inspector.signalProcess(member, signal);
      } catch {
        // The exact process identity is rechecked; a same-tick exit is success.
      }
    }
  }

  private forceStopDescendants(): void {
    let members = this.trackedDescendants;
    try {
      members = this.descendants();
    } catch {
      // Preserve already-captured identities when a final process-table scan fails.
    }
    this.signalMembers(members, "SIGKILL");
  }

  private unionMembers(...groups: ProcessIdentity[][]): ProcessIdentity[] {
    const members: ProcessIdentity[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const member of group) {
        const key = `${member.pid}:${member.started}`;
        if (seen.has(key)) continue;
        seen.add(key);
        members.push(member);
      }
    }
    return members;
  }

  private async stopDescendants(): Promise<ProcessIdentity[]> {
    const captured = this.descendants();
    this.signalMembers(captured, "SIGTERM");
    const capturedSurvivors = await this.waitForMembers(captured);
    const members = this.unionMembers(capturedSurvivors, this.descendants());
    this.signalMembers(members, "SIGKILL");
    const survivors = await this.waitForMembers(members);
    return this.survivors(this.unionMembers(survivors, this.descendants()));
  }

  private async stopShell(): Promise<void> {
    if (!this.exited) {
      try {
        this.terminal.kill("SIGTERM");
      } catch {
        // The exit callback is authoritative.
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)]);
    }
    if (!this.exited) {
      try {
        this.terminal.kill("SIGKILL");
      } catch {
        // The exit callback is authoritative.
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)]);
    }
    if (!this.exited) {
      throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
    }
  }

  private async closeOnce(): Promise<void> {
    let survivors = await this.stopDescendants();
    if (survivors.length > 0) {
      throw new Error(
        `terminal cleanup failed; surviving pids: ${survivors.map((m) => m.pid).join(", ")}`,
      );
    }
    await this.stopShell();
    survivors = await this.stopDescendants();
    if (survivors.length > 0) {
      throw new Error(
        `terminal cleanup failed; surviving pids: ${survivors.map((m) => m.pid).join(", ")}`,
      );
    }
    this.dataDisposable.dispose();
    this.exitDisposable.dispose();
  }
}

export async function spawnNodePtyTerminal(
  spec: SpawnTerminalSpec,
  inspector: ProcessInspector = createProcessInspector(),
): Promise<SubprocessTerminalHandle> {
  spec.signal?.throwIfAborted();
  const file = spec.argv[0];
  if (!file) throw new Error("pty argv must be non-empty");
  let ptyMod: {
    spawn: (
      file: string,
      args: string[] | string,
      opts: object,
    ) => PtyProcess;
  };
  try {
    ptyMod = (await import("node-pty")) as unknown as {
      spawn: (
        file: string,
        args: string[] | string,
        opts: object,
      ) => PtyProcess;
    };
  } catch (error) {
    throw new TerminalError(
      `node-pty is not available: ${error instanceof Error ? error.message : String(error)}`,
      "NO_PTY",
    );
  }
  // Backend passes deliberate overrides; scrub ambient then merge (CV DSH).
  const merged = childEnv(spec.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) env[key] = value;
  }
  const terminal = ptyMod.spawn(file, [...spec.argv.slice(1)], {
    // Match TERM=dumb — DSH subprocess-local uses name: 'dumb', not xterm-256color.
    name: "dumb",
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    env,
  });
  return new LocalTerminalHandle(terminal, inspector, spec.graceMs);
}
