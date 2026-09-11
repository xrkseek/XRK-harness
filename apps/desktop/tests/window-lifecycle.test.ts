import { describe, expect, it, vi } from "vitest";
import {
  attachDesktopWindowLifecycle,
  bindDesktopMainWindowClosed,
  focusOrRecreatePrimaryWindow,
  showDesktopWindowWhenReady,
  type DesktopShellWindow,
} from "../src/window-lifecycle.js";

function fakeWindow(overrides: Partial<DesktopShellWindow> = {}): DesktopShellWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

describe("desktop window lifecycle", () => {
  it("focuses an existing primary window", () => {
    const window = fakeWindow({ isMinimized: () => true });
    focusOrRecreatePrimaryWindow({
      getMain: () => window,
      setMain: vi.fn(),
      createMainWindow: () => {
        throw new Error("must not recreate");
      },
      loadPrimary: vi.fn(),
    });
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("recreates when the primary window is missing", () => {
    const replacement = fakeWindow();
    const setMain = vi.fn();
    const loadPrimary = vi.fn();
    focusOrRecreatePrimaryWindow({
      getMain: () => undefined,
      setMain,
      createMainWindow: () => replacement,
      loadPrimary,
    });
    expect(setMain).toHaveBeenCalledWith(replacement);
    expect(loadPrimary).toHaveBeenCalledWith(replacement);
  });

  it("clears the main slot on closed", () => {
    let closed: (() => void) | undefined;
    const window = fakeWindow({
      on: vi.fn((_event: "closed", listener: () => void) => {
        closed = listener;
      }),
    });
    let main: DesktopShellWindow | undefined = window;
    bindDesktopMainWindowClosed(
      window,
      () => main,
      (next) => {
        main = next;
      },
    );
    closed?.();
    expect(main).toBeUndefined();
  });

  it("shows on ready-to-show when alive", () => {
    let ready: (() => void) | undefined;
    const window = fakeWindow({
      once: vi.fn((_event: "ready-to-show", listener: () => void) => {
        ready = listener;
      }),
    });
    showDesktopWindowWhenReady(window);
    ready?.();
    expect(window.show).toHaveBeenCalledOnce();
  });

  it("activates focus when no windows remain; quits on non-darwin all-closed", () => {
    const quit = vi.fn();
    const focusPrimary = vi.fn();
    let activate: (() => void) | undefined;
    let allClosed: (() => void) | undefined;
    attachDesktopWindowLifecycle(
      {
        quit,
        on: vi.fn((event: "activate" | "window-all-closed", listener: () => void) => {
          if (event === "activate") activate = listener;
          else allClosed = listener;
        }),
      },
      {
        platform: "win32",
        focusPrimary,
        getWindowCount: () => 0,
      },
    );
    activate?.();
    expect(focusPrimary).toHaveBeenCalledOnce();
    allClosed?.();
    expect(quit).toHaveBeenCalledOnce();
  });
});
