import { afterEach, describe, expect, it } from "vitest";
import { declareRuntimeSurface } from "../src/index.js";

describe("cli runtime surface declaration", () => {
  const prev = process.env.XRK_SURFACE;

  afterEach(() => {
    if (prev === undefined) delete process.env.XRK_SURFACE;
    else process.env.XRK_SURFACE = prev;
  });

  it("declares web for serve (the `web` alias maps to serve upstream)", () => {
    delete process.env.XRK_SURFACE;
    declareRuntimeSurface("serve");
    expect(process.env.XRK_SURFACE).toBe("web");
  });

  it("declares cli / acp for run / acp", () => {
    delete process.env.XRK_SURFACE;
    declareRuntimeSurface("run");
    expect(process.env.XRK_SURFACE).toBe("cli");

    delete process.env.XRK_SURFACE;
    declareRuntimeSurface("acp");
    expect(process.env.XRK_SURFACE).toBe("acp");
  });

  it("never overrides an inherited surface (desktop Host wins)", () => {
    process.env.XRK_SURFACE = "desktop";
    declareRuntimeSurface("serve");
    expect(process.env.XRK_SURFACE).toBe("desktop");
  });

  it("leaves attach-only / non-Host commands unset", () => {
    delete process.env.XRK_SURFACE;
    declareRuntimeSurface("tui");
    declareRuntimeSurface("doctor");
    declareRuntimeSurface("restart");
    expect(process.env.XRK_SURFACE).toBeUndefined();
  });
});
