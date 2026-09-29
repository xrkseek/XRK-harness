import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopHostPhase,
  isDesktopHostFetchReady,
  markDesktopHostFetchReady,
  publishDesktopHostPhase,
  resetDesktopHostFetchReady,
  scheduleDesktopHostFetchAttach,
} from "../src/desktop-host-attach.js";
import type { DesktopHostProcess } from "../src/host-process.js";

afterEach(() => {
  resetDesktopHostFetchReady();
});

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

    const fakeHost = {
      fetch: vi.fn(),
      stopWasRequested: false,
      waitForExit: () => new Promise<void>(() => {}),
    } as unknown as DesktopHostProcess;
    resolveHost(fakeHost);
    await hostPromise;
    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledOnce();
    });
    expect(attach).toHaveBeenCalledWith(fakeHost);
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
        return {
          stopWasRequested: false,
          waitForExit: () =>
            startCount === 1 ? exitPromise : new Promise<void>(() => {}),
        } as unknown as DesktopHostProcess;
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
