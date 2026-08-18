import { describe, expect, it } from "vitest";
import { createPtyTools, PTY_TOOL_NAMES, ptyUnavailableMessage } from "../src/tools.js";
import { createTerminalSessionService } from "../src/registry.js";
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionStatus,
  TerminalSignal,
} from "../src/types.js";

class StubSession implements TerminalBackendSession {
  readonly motd = "stub prompt";
  readonly pid = 42;
  statusValue: TerminalSessionStatus = { kind: "running" };

  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    return {
      done: Promise.resolve({
        viewport: "command output",
        waitReason: "stdin_read",
        sessionStatus: this.statusValue,
        truncated: false,
      }),
      readOutput: () => ({ delta: "live", truncated: false }),
      cancel: () => true,
    };
  }

  read() {
    return {
      text: "history",
      totalLines: 1,
      lineBegin: 0,
      lineEnd: 1,
      truncated: false,
    };
  }

  async signal(_signal: TerminalSignal) {
    return { delivered: true as const, targetPgid: 10 };
  }

  status() {
    return this.statusValue;
  }

  async close() {
    this.statusValue = { kind: "exited", exitCode: 0, signal: null };
  }
}

function stubBackend(): TerminalBackend {
  return {
    type: "stub",
    async spawn() {
      return new StubSession();
    },
  };
}

function byName(tools: ReturnType<typeof createPtyTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing ${name}`);
  return tool;
}

describe("createPtyTools", () => {
  it("always registers six tools; missing service is an honest error", async () => {
    const tools = createPtyTools({ workspaceRoot: "/ws" });
    expect(tools.map((t) => t.name)).toEqual([...PTY_TOOL_NAMES]);
    const opened = await byName(tools, "terminal_open").execute({ type: "shell" });
    expect(opened.isError).toBe(true);
    expect(opened.content).toBe(ptyUnavailableMessage());
  });

  it("drives the stub lifecycle through all six tools", async () => {
    const service = createTerminalSessionService();
    service.registerBackend(stubBackend());
    const tools = createPtyTools({
      workspaceRoot: "/ws",
      service,
      enableRunInBackground: false,
    });

    const opened = await byName(tools, "terminal_open").execute({
      type: "stub",
      name: "main",
    });
    expect(opened.isError).toBeUndefined();
    expect(opened.content).toContain("started terminal session pty-1 (main)");
    expect(opened.meta).toMatchObject({
      sessionId: "pty-1",
      type: "stub",
      name: "main",
      motd: "stub prompt",
    });

    const sent = await byName(tools, "terminal_send").execute({
      sessionId: "pty-1",
      text: "ls",
    });
    expect(sent.content).toContain("command output");
    expect(sent.content).toContain("[wait: stdin_read]");
    expect(sent.meta).toEqual({
      viewport: "command output",
      waitReason: "stdin_read",
      sessionStatus: { kind: "running" },
      truncated: false,
    });
    expect(
      byName(tools, "terminal_send").presentCall?.({ sessionId: "pty-1", text: "ls" }),
    ).toEqual({
      card: "terminal",
      title: "ls",
      description: "Terminal pty-1",
    });

    const read = await byName(tools, "terminal_read").execute({ sessionId: "pty-1" });
    expect(read.content).toContain("history");
    expect(read.meta).toMatchObject({
      text: "history",
      totalLines: 1,
      lineBegin: 0,
      lineEnd: 1,
      truncated: false,
    });

    const signaled = await byName(tools, "terminal_signal").execute({
      sessionId: "pty-1",
      signal: "SIGINT",
    });
    expect(signaled.content).toContain("foreground process group 10");
    expect(signaled.meta).toEqual({ targetPgid: 10, signal: "SIGINT" });

    const listed = await byName(tools, "terminal_list").execute({});
    expect(listed.content).toContain("pty-1 (main)");
    expect(listed.meta).toMatchObject({
      sessions: [{ sessionId: "pty-1", name: "main", type: "stub" }],
    });

    const closed = await byName(tools, "terminal_close").execute({
      sessionId: "pty-1",
    });
    expect(closed.content).toContain("closed terminal session pty-1");
  });

  it("run_in_background without jobs is an honest error", async () => {
    const service = createTerminalSessionService();
    service.registerBackend(stubBackend());
    const tools = createPtyTools({ workspaceRoot: "/ws", service });
    await byName(tools, "terminal_open").execute({ type: "stub" });
    const bg = await byName(tools, "terminal_send").execute({
      sessionId: "pty-1",
      text: "sleep",
      run_in_background: true,
    });
    expect(bg.isError).toBe(true);
    expect(bg.content).toMatch(/jobs registry|background/);
  });

  it("run_in_background registers pty-send via jobs bridge", async () => {
    const service = createTerminalSessionService();
    service.registerBackend(stubBackend());
    const managed: {
      cancel(): void;
      done: Promise<{ status: "completed" | "killed" | "failed"; detail?: string }>;
      readOutput?(): string;
    }[] = [];
    const jobs = {
      startManagedJob(spec: {
        kind: string;
        label: string;
        run: () => (typeof managed)[number];
      }) {
        expect(spec.kind).toBe("pty-send");
        const hooks = spec.run();
        managed.push(hooks);
        return { id: "pty-send-1" };
      },
    };
    const tools = createPtyTools({ workspaceRoot: "/ws", service, jobs });
    await byName(tools, "terminal_open").execute({ type: "stub" });
    const bg = await byName(tools, "terminal_send").execute({
      sessionId: "pty-1",
      text: "ls",
      run_in_background: true,
    });
    expect(bg.isError).toBeUndefined();
    expect(bg.content).toBe("started background job pty-send-1");
    expect(bg.meta).toEqual({ kind: "background", jobId: "pty-send-1" });
    expect(
      byName(tools, "terminal_send").presentCall?.({
        sessionId: "pty-1",
        text: "ls",
        run_in_background: true,
      }),
    ).toMatchObject({
      card: "generic",
      title: "Send to terminal pty-1 in background",
    });
    await managed[0]!.done;
  });
});
