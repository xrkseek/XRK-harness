/**
 * CLI logger unit tests — level resolution and line format.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliLogger, resolveLogLevel } from "../src/log.js";

describe("cli log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves level from flags and env", () => {
    expect(resolveLogLevel({ quiet: true })).toBe("warn");
    expect(resolveLogLevel({ verbose: true })).toBe("debug");
    expect(resolveLogLevel({ env: { XRK_LOG: "error" } })).toBe("error");
    expect(resolveLogLevel({ env: { XRK_LOG_LEVEL: "debug" } })).toBe("debug");
    expect(resolveLogLevel({})).toBe("info");
  });

  it("writes leveled lines and scopes children", () => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const log = createCliLogger("debug");
    log.info("hello");
    log.child("plugin").debug("add foo");
    log.warn("careful");

    expect(out.some((l) => /info\s+hello/.test(l))).toBe(true);
    expect(err.some((l) => /debug\s+plugin\s+add foo/.test(l))).toBe(true);
    expect(err.some((l) => /warn\s+careful/.test(l))).toBe(true);
  });

  it("respects silent level", () => {
    const spy = vi.spyOn(process.stdout, "write");
    createCliLogger("silent").info("nope");
    expect(spy).not.toHaveBeenCalled();
  });
});
