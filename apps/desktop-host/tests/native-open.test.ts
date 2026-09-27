import { afterEach, describe, expect, it } from "vitest";
import {
  declareDesktopNativeOpenCapabilities,
  declareDesktopRuntimeSurface,
} from "../src/boot.js";

describe("desktop-host native open declaration", () => {
  const prev = process.env.XRK_NATIVE_OPEN;

  afterEach(() => {
    if (prev === undefined) delete process.env.XRK_NATIVE_OPEN;
    else process.env.XRK_NATIVE_OPEN = prev;
  });

  it("sets XRK_NATIVE_OPEN so Face canOpenPath / pickDirectory stay true", () => {
    delete process.env.XRK_NATIVE_OPEN;
    declareDesktopNativeOpenCapabilities();
    expect(process.env.XRK_NATIVE_OPEN).toBe("1");
  });
});

describe("desktop-host runtime surface declaration", () => {
  const prevSurface = process.env.XRK_SURFACE;

  afterEach(() => {
    if (prevSurface === undefined) delete process.env.XRK_SURFACE;
    else process.env.XRK_SURFACE = prevSurface;
  });

  it("declares XRK_SURFACE=desktop so the model tells web from desktop", () => {
    delete process.env.XRK_SURFACE;
    declareDesktopRuntimeSurface();
    expect(process.env.XRK_SURFACE).toBe("desktop");
  });

  it("does not overwrite an explicit XRK_SURFACE", () => {
    process.env.XRK_SURFACE = "web";
    declareDesktopRuntimeSurface();
    expect(process.env.XRK_SURFACE).toBe("web");
  });
});
