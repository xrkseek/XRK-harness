import { describe, expect, it } from "vitest";
import { windowsPtySpawnOptions } from "../src/windows-pty.js";

describe("windowsPtySpawnOptions", () => {
  it("requests ConPTY on win32 and is empty elsewhere", () => {
    const opts = windowsPtySpawnOptions();
    if (process.platform === "win32") {
      expect(opts).toEqual({
        useConpty: true,
        conptyInheritCursor: false,
      });
    } else {
      expect(opts).toEqual({});
    }
  });
});
