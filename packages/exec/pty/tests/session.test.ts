import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { defaultPtyBackendConfig } from "../src/config.js";
import { CONTROLLED_PROMPT } from "../src/sanitize.js";
import { LocalPtySession } from "../src/session.js";
import type {
  SubprocessTerminalHandle,
  TerminalForeground,
  TerminalOutcome,
  TerminalSignal,
} from "../src/types.js";
import { TerminalError } from "../src/types.js";

class FakeTerminal implements SubprocessTerminalHandle {
  pid = 123;
  readonly output = new PassThrough();
  readonly writes: string[] = [];
  readonly kills: string[] = [];
  foreground: TerminalForeground | undefined = {
    processGroupId: 123,
    inputWaiting: false,
  };
  private resolveDone!: (outcome: TerminalOutcome) => void;
  readonly done: Promise<TerminalOutcome>;
  autoExitOnKill = true;
  private cleanup: Promise<void> | undefined;

  constructor() {
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  emitData(data: string): void {
    this.output.write(Buffer.from(data, "utf8"));
  }

  emitExit(exitCode = 0, signal?: number): void {
    this.output.end();
    this.resolveDone({
      exitCode: signal === undefined || signal === 0 ? exitCode : null,
      signal: signal === 9 ? "SIGKILL" : signal === 15 ? "SIGTERM" : null,
    });
  }

  async write(data: string): Promise<void> {
    this.writes.push(data);
  }

  async inspectForeground(): Promise<TerminalForeground | undefined> {
    return this.foreground;
  }

  async signalForeground(signal: TerminalSignal): Promise<number> {
    const foreground = await this.inspectForeground();
    if (foreground === undefined) {
      throw new Error(`cannot resolve foreground process group for terminal ${this.pid}`);
    }
    if (signal === "SIGKILL" && foreground.processGroupId === this.pid) {
      throw new Error(
        "refusing to SIGKILL the terminal shell; terminate the terminal session instead",
      );
    }
    this.kills.push(signal);
    return foreground.processGroupId;
  }

  terminate(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup;
    this.cleanup = this.terminateOnce();
    return this.cleanup;
  }

  private async terminateOnce(): Promise<void> {
    this.kills.push("SIGTERM");
    if (this.autoExitOnKill) this.emitExit(0, 15);
  }
}

function config() {
  return defaultPtyBackendConfig({
    rows: 24,
    cols: 80,
    scrollbackLines: 10,
    scrollbackMaxBytes: 128,
    maxReadBytes: 64,
    pollIntervalMs: 10,
    exactProbeAfterMs: 20,
    idleSilenceMs: 50,
    handoffGraceMs: 10,
    timeoutMs: 100,
    disposeGraceMs: 20,
  });
}

async function initialize(session: LocalPtySession, terminal: FakeTerminal): Promise<void> {
  const pending = session.initialize();
  terminal.emitData(`\x1b]133;D;0\x07${CONTROLLED_PROMPT}`);
  await vi.advanceTimersByTimeAsync(10);
  await pending;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LocalPtySession", () => {
  it("captures prompt MOTD, writes submit explicitly, and settles stdin_read", async () => {
    vi.useFakeTimers();
    const terminal = new FakeTerminal();
    const session = new LocalPtySession(terminal, config());
    await initialize(session, terminal);
    expect(session.motd).toContain(CONTROLLED_PROMPT);

    const operation = session.startSend({ text: "true", submit: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(terminal.writes).toEqual(["true\r"]);
    terminal.emitData(`ok\x1b]133;D;0\x07${CONTROLLED_PROMPT}`);
    await vi.advanceTimersByTimeAsync(10);
    const result = await operation.done;
    expect(result.waitReason).toBe("stdin_read");
    expect(result.viewport).toContain("ok");
  });

  it("rejects a second send while one is active", async () => {
    vi.useFakeTimers();
    const terminal = new FakeTerminal();
    const session = new LocalPtySession(terminal, config());
    await initialize(session, terminal);
    session.startSend({ text: "sleep", submit: true });
    expect(() => session.startSend({ text: "next", submit: true })).toThrow(
      TerminalError,
    );
  });

  it("times out when no readiness evidence arrives", async () => {
    vi.useFakeTimers();
    const terminal = new FakeTerminal();
    terminal.foreground = undefined;
    const session = new LocalPtySession(terminal, config());
    await Promise.all([
      expect(session.initialize()).rejects.toThrow(/startup timeout/),
      vi.advanceTimersByTimeAsync(100),
    ]);
  });
});
