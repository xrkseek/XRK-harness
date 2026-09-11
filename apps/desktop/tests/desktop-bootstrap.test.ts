import { describe, expect, it, vi } from "vitest";
import { startDesktopMain } from "../src/desktop-bootstrap.js";
import type { DesktopShellWindow } from "../src/window-lifecycle.js";

function fakeWindow(): DesktopShellWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    once: vi.fn((event, listener) => {
      if (event === "ready-to-show") listener();
    }),
    on: vi.fn(),
  };
}

describe("startDesktopMain", () => {
  it("returns false for a secondary instance without whenReady work", async () => {
    const whenReady = vi.fn(async () => undefined);
    const ok = startDesktopMain(
      {
        requestSingleInstanceLock: () => false,
        quit: vi.fn(),
        on: vi.fn(),
        whenReady,
      },
      {
        createWindow: () => fakeWindow(),
        loadPrimary: vi.fn(),
        getWindowCount: () => 0,
      },
    );
    expect(ok).toBe(false);
    expect(whenReady).not.toHaveBeenCalled();
  });

  it("creates and loads the primary window after whenReady", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const loadPrimary = vi.fn();
    const window = fakeWindow();
    const ok = startDesktopMain(
      {
        requestSingleInstanceLock: () => true,
        quit: vi.fn(),
        on: vi.fn(),
        whenReady: () => ready,
      },
      {
        createWindow: () => window,
        loadPrimary,
        getWindowCount: () => 1,
        platform: "linux",
      },
    );
    expect(ok).toBe(true);
    resolveReady();
    await ready;
    await Promise.resolve();
    expect(loadPrimary).toHaveBeenCalledWith(window);
    expect(window.show).toHaveBeenCalledOnce();
  });
});
