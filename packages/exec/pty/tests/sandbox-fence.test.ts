import { describe, expect, it } from "vitest";
import { sandboxModeChangeBlockedMessage } from "../src/sandbox-fence.js";

describe("sandboxModeChangeBlockedMessage", () => {
  it("allows same mode or idle registry", () => {
    expect(
      sandboxModeChangeBlockedMessage({
        currentMode: "workspace-write",
        nextMode: "workspace-write",
        hasPtyActivity: true,
      }),
    ).toBeUndefined();
    expect(
      sandboxModeChangeBlockedMessage({
        currentMode: "workspace-write",
        nextMode: "read-only",
        hasPtyActivity: false,
      }),
    ).toBeUndefined();
  });

  it("blocks mode changes while PTY activity exists", () => {
    expect(
      sandboxModeChangeBlockedMessage({
        currentMode: "workspace-write",
        nextMode: "read-only",
        hasPtyActivity: true,
      }),
    ).toMatch(/cannot change sandbox mode/);
  });
});
