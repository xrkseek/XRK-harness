import { describe, expect, it } from "vitest";
import { formatToolError, sessionNotFoundMessage } from "../src/face-error-text.js";

describe("formatToolError", () => {
  it("expands a bare session id", () => {
    expect(
      formatToolError({
        code: "session-not-found",
        message: "sess_mvdlyfq8_kiy0l3",
      }),
    ).toBe(
      "session-not-found: Session sess_mvdlyfq8_kiy0l3 was not found.",
    );
  });

  it("keeps a sentence and still names the code", () => {
    expect(
      formatToolError({
        code: "subagent-not-found",
        message: sessionNotFoundMessage("nope"),
      }),
    ).toBe("subagent-not-found: Session nope was not found.");
  });

  it("does not double-prefix", () => {
    const once = formatToolError({
      code: "session-not-found",
      message: "sess_abc",
    });
    expect(formatToolError({ code: "session-not-found", message: once })).toBe(once);
  });
});
