import { afterEach, describe, expect, it } from "vitest";
import { declareDesktopNativeOpenCapabilities } from "../src/boot.js";

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
