import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installSpawnDetachedForTests,
  isAbsoluteUrl,
  isTermuxEnv,
  normalizeOpenPath,
  openNativePath,
  revealNativePath,
  windowsExplorerPath,
} from "../src/host-open-path.js";

describe("normalizeOpenPath", () => {
  it("strips trailing slash-dot from client joins", () => {
    expect(normalizeOpenPath("C:\\proj\\.")).toBe("C:\\proj");
    expect(normalizeOpenPath("/proj/.")).toBe("/proj");
    expect(normalizeOpenPath("/proj/")).toBe("/proj");
    expect(normalizeOpenPath("/proj/./.")).toBe("/proj");
  });

  it("keeps POSIX and Windows drive roots qualified", () => {
    expect(normalizeOpenPath("/.")).toBe("/");
    expect(normalizeOpenPath("/")).toBe("/");
    expect(normalizeOpenPath("C:\\.")).toBe("C:\\");
    expect(normalizeOpenPath("C:/.")).toBe("C:/");
    expect(normalizeOpenPath("C:\\")).toBe("C:\\");
  });
});

describe("windowsExplorerPath", () => {
  it("forces backslashes so Explorer /select does not eat path segments", () => {
    expect(windowsExplorerPath("C:/Users/x/proj/file.txt")).toBe(
      "C:\\Users\\x\\proj\\file.txt",
    );
    expect(windowsExplorerPath("C:\\Users\\x\\proj\\.")).toBe(
      "C:\\Users\\x\\proj",
    );
    expect(windowsExplorerPath("C:/.")).toBe("C:\\");
  });
});

describe("isAbsoluteUrl", () => {
  it("recognizes http(s) and custom schemes without treating paths as URLs", () => {
    expect(isAbsoluteUrl("https://example.com/a")).toBe(true);
    expect(isAbsoluteUrl("http://127.0.0.1:3080/sidebar/html/s/a.html")).toBe(
      true,
    );
    expect(isAbsoluteUrl("vscode://file/x")).toBe(true);
    expect(isAbsoluteUrl("C:\\Users\\x\\a.txt")).toBe(false);
    expect(isAbsoluteUrl("/home/u/a.txt")).toBe(false);
  });
});

describe("revealNativePath win32", () => {
  afterEach(() => {
    installSpawnDetachedForTests(undefined);
  });

  it("reveals files via cmd start + explorer /select (ShellExecute, visible)", async () => {
    if (process.platform !== "win32") return;
    const dir = await mkdtemp(join(tmpdir(), "xrk-reveal-"));
    const file = join(dir, "a.txt");
    await writeFile(file, "x");
    const calls: { command: string; args: readonly string[]; hide?: boolean }[] =
      [];
    installSpawnDetachedForTests(async (command, args, options) => {
      calls.push({
        command,
        args,
        hide: options?.windowsHide,
      });
    });
    await revealNativePath(file.replace(/\\/g, "/"), "win32");
    expect(calls).toEqual([
      {
        command: "cmd.exe",
        args: ["/c", "start", "", "explorer.exe", `/select,${file}`],
        hide: false,
      },
    ]);
  });

  it("opens directories via ShellExecute start (not /select)", async () => {
    if (process.platform !== "win32") return;
    const dir = await mkdtemp(join(tmpdir(), "xrk-reveal-dir-"));
    const calls: { command: string; args: readonly string[] }[] = [];
    installSpawnDetachedForTests(async (command, args) => {
      calls.push({ command, args });
    });
    await revealNativePath(dir, "win32");
    expect(calls).toEqual([
      {
        command: "cmd.exe",
        args: ["/c", "start", "", windowsExplorerPath(dir)],
      },
    ]);
  });
});

describe("Termux / Linux open scenario", () => {
  afterEach(() => {
    installSpawnDetachedForTests(undefined);
  });

  it("detects Termux via TERMUX_VERSION or PREFIX", () => {
    expect(isTermuxEnv({ TERMUX_VERSION: "0.118.0" })).toBe(true);
    expect(isTermuxEnv({ PREFIX: "/data/data/com.termux/files/usr" })).toBe(
      true,
    );
    expect(isTermuxEnv({ DISPLAY: ":0" })).toBe(false);
  });

  it("opens via termux-open on Termux Linux", async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    installSpawnDetachedForTests(async (command, args) => {
      calls.push({ command, args });
    });
    await openNativePath("/data/data/com.termux/files/home/a.txt", "linux", {
      TERMUX_VERSION: "0.118.0",
    });
    expect(calls).toEqual([
      { command: "termux-open", args: ["/data/data/com.termux/files/home/a.txt"] },
    ]);
  });

  it("opens via xdg-open on GUI Linux", async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    installSpawnDetachedForTests(async (command, args) => {
      calls.push({ command, args });
    });
    await openNativePath("/home/u/a.txt", "linux", { DISPLAY: ":0" });
    expect(calls).toEqual([{ command: "xdg-open", args: ["/home/u/a.txt"] }]);
  });
});
