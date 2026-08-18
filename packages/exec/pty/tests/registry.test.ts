import { describe, expect, it } from "vitest";
import { createTerminalSessionService } from "../src/registry.js";
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionStatus,
  TerminalSignal,
} from "../src/types.js";
import { TerminalError } from "../src/types.js";

class StubSession implements TerminalBackendSession {
  readonly motd = "stub ready";
  readonly pid = 42;
  statusValue: TerminalSessionStatus = { kind: "running" };
  closed: string[] = [];

  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    return {
      done: Promise.resolve({
        viewport: "done",
        waitReason: "stdin_read",
        sessionStatus: this.statusValue,
        truncated: false,
      }),
      readOutput: () => ({ delta: "delta", truncated: false }),
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

  async signal(signal: TerminalSignal) {
    return { delivered: true as const, targetPgid: signal === "SIGINT" ? 10 : 11 };
  }

  status() {
    return this.statusValue;
  }

  async close(reason: string) {
    this.closed.push(reason);
    this.statusValue = { kind: "exited", exitCode: 0, signal: null };
  }
}

function stubBackend(type = "stub"): {
  backend: TerminalBackend;
  sessions: StubSession[];
} {
  const sessions: StubSession[] = [];
  return {
    sessions,
    backend: {
      type,
      async spawn() {
        const session = new StubSession();
        sessions.push(session);
        return session;
      },
    },
  };
}

describe("createTerminalSessionService", () => {
  it("spawns, lists, sends, and closes composition-scoped sessions", async () => {
    const service = createTerminalSessionService();
    const stub = stubBackend();
    service.registerBackend(stub.backend);

    const spawned = await service.spawn({ type: "stub", name: "main" });
    expect(spawned.sessionId).toBe("pty-1");
    expect(spawned.motd).toBe("stub ready");
    expect(service.list()).toHaveLength(1);

    const sent = await service.startSend("pty-1", { text: "ls", submit: true }).done;
    expect(sent.viewport).toBe("done");
    expect(service.read("pty-1").text).toBe("history");
    expect((await service.signal("pty-1", "SIGINT")).targetPgid).toBe(10);

    expect(await service.kill("pty-1")).toBe(true);
    expect(service.list()).toHaveLength(0);
    expect(service.hasActivity()).toBe(false);
    expect(stub.sessions[0]?.closed).toContain("model request");
  });

  it("forwards ownerSessionId to the backend spawn spec", async () => {
    const service = createTerminalSessionService();
    let seen: string | undefined;
    service.registerBackend({
      type: "stub",
      async spawn(spec) {
        seen = spec.ownerSessionId;
        return new StubSession();
      },
    });
    await service.spawn({ type: "stub", ownerSessionId: "sess-9" });
    expect(seen).toBe("sess-9");
    await service.kill("pty-1");
  });

  it("reports hasActivity across spawn-to-close (CV DSH hasOwnerActivity)", async () => {
    const service = createTerminalSessionService();
    expect(service.hasActivity()).toBe(false);
    service.registerBackend(stubBackend().backend);
    const spawned = service.spawn({ type: "stub" });
    // Pending spawn counts before publication.
    expect(service.hasActivity()).toBe(true);
    await spawned;
    expect(service.hasActivity()).toBe(true);
    await service.kill("pty-1");
    expect(service.hasActivity()).toBe(false);
  });

  it("rejects unknown backends, duplicate names, and missing sessions", async () => {
    const service = createTerminalSessionService();
    service.registerBackend(stubBackend().backend);
    await expect(service.spawn({ type: "missing" })).rejects.toMatchObject({
      code: "NO_BACKEND",
    });
    await service.spawn({ type: "stub", name: "main" });
    await expect(service.spawn({ type: "stub", name: "main" })).rejects.toMatchObject({
      code: "DUPLICATE_NAME",
    });
    expect(() => service.read("pty-999")).toThrow(TerminalError);
  });
});
