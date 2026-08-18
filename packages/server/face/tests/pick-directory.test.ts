import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  NativePickerCommandError,
  WIN32_POWERSHELL_PICK,
  canPickNativeDirectory,
  pickNativeDirectory,
  type DirectoryPickerRunner,
} from "../src/host-pick-directory.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

function fail(
  code: string | number,
  stderr = "",
): never {
  throw new NativePickerCommandError("picker failed", { code, stderr });
}

describe("pickNativeDirectory", () => {
  it("treats Win / macOS / Linux as desktop pickers", () => {
    expect(canPickNativeDirectory("win32")).toBe(true);
    expect(canPickNativeDirectory("darwin")).toBe(true);
    expect(canPickNativeDirectory("linux")).toBe(true);
    expect(canPickNativeDirectory("freebsd")).toBe(false);
  });

  it("darwin osascript: path, cancel, unexpected failure", async () => {
    const signal = new AbortController().signal;
    const run: DirectoryPickerRunner = async (command, args) => {
      expect(command).toBe("osascript");
      expect(args).toContain("-e");
      expect(args.some((a) => a.includes("Select Workspace Directory"))).toBe(
        true,
      );
      return { stdout: "/Users/xrk/project\n" };
    };
    await expect(
      pickNativeDirectory(signal, { platform: "darwin", run }),
    ).resolves.toBe("/Users/xrk/project");

    await expect(
      pickNativeDirectory(signal, {
        platform: "darwin",
        run: async () => fail(1, "User canceled. (-128)"),
      }),
    ).resolves.toBeNull();

    await expect(
      pickNativeDirectory(signal, {
        platform: "darwin",
        run: async () => fail(1, "osascript: execution error"),
      }),
    ).rejects.toBeInstanceOf(NativePickerCommandError);
  });

  it("linux: zenity path, cancel, then kdialog fallback", async () => {
    const signal = new AbortController().signal;
    await expect(
      pickNativeDirectory(signal, {
        platform: "linux",
        run: async (command, args) => {
          expect(command).toBe("zenity");
          expect(args).toEqual([
            "--file-selection",
            "--directory",
            "--title=Select Workspace Directory",
          ]);
          return { stdout: "/home/xrk/ws" };
        },
      }),
    ).resolves.toBe("/home/xrk/ws");

    await expect(
      pickNativeDirectory(signal, {
        platform: "linux",
        run: async () => fail(1),
      }),
    ).resolves.toBeNull();

    const seen: string[] = [];
    await expect(
      pickNativeDirectory(signal, {
        platform: "linux",
        run: async (command, args) => {
          seen.push(command);
          if (command === "zenity") fail("ENOENT");
          expect(command).toBe("kdialog");
          expect(args[0]).toBe("--getexistingdirectory");
          return { stdout: "/home/xrk/kdialog-ws\n" };
        },
      }),
    ).resolves.toBe("/home/xrk/kdialog-ws");
    expect(seen).toEqual(["zenity", "kdialog"]);

    await expect(
      pickNativeDirectory(signal, {
        platform: "linux",
        run: async () => fail("ENOENT"),
      }),
    ).rejects.toThrow(/zenity or kdialog/);
  });

  it("win32 PowerShell STA FolderBrowserDialog; exit 1 is cancel", async () => {
    const signal = new AbortController().signal;
    await expect(
      pickNativeDirectory(signal, {
        platform: "win32",
        run: async (command, args) => {
          expect(command).toBe("powershell.exe");
          expect(args).toEqual([
            "-NoProfile",
            "-STA",
            "-Command",
            WIN32_POWERSHELL_PICK,
          ]);
          expect(WIN32_POWERSHELL_PICK).toContain("FolderBrowserDialog");
          return { stdout: "C:\\Users\\xrk\\project" };
        },
      }),
    ).resolves.toBe("C:\\Users\\xrk\\project");

    await expect(
      pickNativeDirectory(signal, {
        platform: "win32",
        run: async () => fail(1),
      }),
    ).resolves.toBeNull();
  });

  it("unsupported platform throws", async () => {
    await expect(
      pickNativeDirectory(new AbortController().signal, {
        platform: "freebsd",
        run: async () => {
          throw new Error("should not run");
        },
      }),
    ).rejects.toThrow(/unsupported on freebsd/);
  });

  it("aborted signal does not spawn", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      pickNativeDirectory(ac.signal, {
        platform: "linux",
        run: async () => {
          throw new Error("should not run");
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("host.pickDirectory Face RPC", () => {
  it("returns selected path and cancel-as-null; never pops a dialog", async () => {
    const picked = createBareFaceRuntime({
      store: createMemorySessionStore(),
      pickNativeDirectory: async () => "/tmp/workspace",
    });
    const ok = await dispatchFaceMethod(
      picked,
      "host.pickDirectory",
      "pd1",
      {},
    );
    expect(ok.result).toEqual({ ok: true, value: { path: "/tmp/workspace" } });

    const cancelled = createBareFaceRuntime({
      store: createMemorySessionStore(),
      pickNativeDirectory: async () => null,
    });
    const cancel = await dispatchFaceMethod(
      cancelled,
      "host.pickDirectory",
      "pd2",
      {},
    );
    expect(cancel.result).toEqual({ ok: true, value: { path: null } });
  });

  it("maps picker failure to directory-picker-unavailable", async () => {
    const runtime = createBareFaceRuntime({
      store: createMemorySessionStore(),
      pickNativeDirectory: async () => {
        throw new Error("no supported native directory picker found (install zenity or kdialog)");
      },
    });
    const res = await dispatchFaceMethod(
      runtime,
      "host.pickDirectory",
      "pd3",
      {},
    );
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) {
      expect(res.result.error.code).toBe("directory-picker-unavailable");
    }
  });

  it("maps abort to cancelled", async () => {
    const runtime = createBareFaceRuntime({
      store: createMemorySessionStore(),
      pickNativeDirectory: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    });
    const res = await dispatchFaceMethod(
      runtime,
      "host.pickDirectory",
      "pd4",
      {},
    );
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) {
      expect(res.result.error.code).toBe("cancelled");
    }
  });
});
