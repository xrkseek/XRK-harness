import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLastHostFailure,
  getDesktopHostPhase,
  getLastHostFailure,
  isDesktopHostFetchReady,
  markDesktopHostFetchReady,
  publishDesktopHostFailed,
  publishDesktopHostPhase,
  resetDesktopHostFetchReady,
  scheduleDesktopHostFetchAttach,
} from "../src/desktop-host-attach.js";
import type { DesktopHostProcess } from "../src/host-process.js";

afterEach(() => {
  resetDesktopHostFetchReady();
  clearLastHostFailure();
});

function fakeHost(
  overrides: Partial<DesktopHostProcess> & {
    waitForExit?: () => Promise<void>;
  } = {},
): DesktopHostProcess {
  return {
    faceOrigin: "http://127.0.0.1:9",
    stopWasRequested: false,
    lastDeath: undefined,
    waitForExit: () => new Promise<void>(() => {}),
    stop: vi.fn(async () => {}),
    ...overrides,
  } as unknown as DesktopHostProcess;
}

describe("scheduleDesktopHostFetchAttach", () => {
  it("does not block the caller and attaches after Host ready", async () => {
    let resolveHost!: (host: DesktopHostProcess) => void;
    const hostPromise = new Promise<DesktopHostProcess | undefined>((resolve) => {
      resolveHost = resolve;
    });
    const attach = vi.fn();
    const onPhase = vi.fn();
    let returned = false;
    scheduleDesktopHostFetchAttach({
      start: async ({ onSpawned }) => {
        onSpawned();
        return hostPromise;
      },
      attach,
      onPhase,
    });
    returned = true;
    expect(returned).toBe(true);
    expect(attach).not.toHaveBeenCalled();
    expect(onPhase).toHaveBeenCalledWith("starting");
    expect(onPhase).toHaveBeenCalledWith("attaching");

    const host = fakeHost();
    resolveHost(host);
    await hostPromise;
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledOnce();
    });
    expect(attach).toHaveBeenCalledWith(host);
  });

  it("skips attach when Host start returns undefined and reports failure", async () => {
    const attach = vi.fn();
    const onFailed = vi.fn();
    scheduleDesktopHostFetchAttach({
      start: async ({ onSpawned }) => {
        onSpawned();
        return undefined;
      },
      attach,
      onFailed,
    });
    await vi.waitFor(() => {
      expect(onFailed).toHaveBeenCalledOnce();
    });
    expect(attach).not.toHaveBeenCalled();
  });

  it("retries start failures within restartMaxAttempts then fails", async () => {
    const onFailed = vi.fn();
    let starts = 0;
    scheduleDesktopHostFetchAttach({
      start: async ({ onSpawned }) => {
        starts += 1;
        onSpawned();
        return undefined;
      },
      attach: vi.fn(),
      onFailed,
      restartMaxAttempts: 2,
      restartDelayMs: 5,
    });
    await vi.waitFor(() => {
      expect(onFailed).toHaveBeenCalledOnce();
    });
    expect(starts).toBe(3);
  });

  it("restarts after unexpected Host exit when restartMaxAttempts is set", async () => {
    let exitResolve!: () => void;
    const exitPromise = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });
    const attach = vi.fn();
    const detach = vi.fn();
    let startCount = 0;
    scheduleDesktopHostFetchAttach({
      start: async ({ onSpawned }) => {
        startCount += 1;
        onSpawned();
        return fakeHost({
          waitForExit: () =>
            startCount === 1 ? exitPromise : new Promise<void>(() => {}),
        });
      },
      attach,
      detach,
      restartMaxAttempts: 2,
      restartDelayMs: 10,
    });
    await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    exitResolve();
    await vi.waitFor(() => expect(detach).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(2));
    expect(startCount).toBe(2);
  });

  it("rebring clears sticky failure and starts again after budget exhaust", async () => {
    const onFailed = vi.fn();
    let starts = 0;
    const handle = scheduleDesktopHostFetchAttach({
      start: async ({ onSpawned }) => {
        starts += 1;
        onSpawned();
        if (starts <= 2) return undefined;
        return fakeHost();
      },
      attach: vi.fn(),
      onFailed,
      restartMaxAttempts: 1,
      restartDelayMs: 5,
    });
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(getLastHostFailure()).toBeUndefined();
    publishDesktopHostFailed("fail", [], "budget gone");
    expect(getLastHostFailure()).toBe("budget gone");
    const before = starts;
    handle.rebring();
    await vi.waitFor(() => expect(starts).toBeGreaterThan(before));
    expect(getLastHostFailure()).toBeUndefined();
  });

  it("rebring is a no-op while Host Fetch is ready and healthy", async () => {
    let starts = 0;
    const handle = scheduleDesktopHostFetchAttach({
      start: async ({ onSpawned }) => {
        starts += 1;
        onSpawned();
        return fakeHost();
      },
      attach: () => {
        markDesktopHostFetchReady("ready", "phase", []);
      },
    });
    await vi.waitFor(() => expect(starts).toBe(1));
    await vi.waitFor(() => expect(isDesktopHostFetchReady()).toBe(true));
    handle.rebring();
    expect(starts).toBe(1);
  });
});

describe("host fetch ready gate", () => {
  it("starts unset and flips once on mark", () => {
    expect(isDesktopHostFetchReady()).toBe(false);
    expect(getDesktopHostPhase()).toBe("starting");
    const send = vi.fn();
    markDesktopHostFetchReady(
      "xrk-desktop:host-ready",
      "xrk-desktop:host-phase",
      [{ send }],
    );
    expect(isDesktopHostFetchReady()).toBe(true);
    expect(getDesktopHostPhase()).toBe("ready");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("xrk-desktop:host-phase", "ready");
    expect(send).toHaveBeenCalledWith("xrk-desktop:host-ready");
  });

  it("stores sticky failure on publishDesktopHostFailed and clears on mark ready", () => {
    publishDesktopHostFailed("fail", [], "nope");
    expect(getLastHostFailure()).toBe("nope");
    markDesktopHostFetchReady("ready", "phase", []);
    expect(getLastHostFailure()).toBeUndefined();
  });

  it("does not re-broadcast on a second mark", () => {
    const send = vi.fn();
    markDesktopHostFetchReady("ready", "phase", [{ send }]);
    markDesktopHostFetchReady("ready", "phase", [{ send }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("survives a sender that throws", () => {
    const bad = {
      send: () => {
        throw new Error("destroyed");
      },
    };
    const good = { send: vi.fn() };
    markDesktopHostFetchReady("ready", "phase", [bad, good]);
    expect(isDesktopHostFetchReady()).toBe(true);
    expect(good.send).toHaveBeenCalledTimes(2);
  });
});

describe("publishDesktopHostPhase", () => {
  it("advances forward-only and notifies windows", () => {
    const send = vi.fn();
    publishDesktopHostPhase("attaching", "phase", [{ send }]);
    expect(getDesktopHostPhase()).toBe("attaching");
    expect(send).toHaveBeenCalledWith("phase", "attaching");
    send.mockClear();
    publishDesktopHostPhase("starting", "phase", [{ send }]);
    expect(getDesktopHostPhase()).toBe("attaching");
    expect(send).not.toHaveBeenCalled();
  });
});
