import { describe, expect, it } from "vitest";
import {
  boundTerminalText,
  renderList,
  renderRead,
  renderSend,
  renderSendRead,
  renderSpawn,
} from "../src/render.js";

describe("pty rendering", () => {
  it("renders spawn with and without names or MOTD", () => {
    expect(
      renderSpawn(
        {
          sessionId: "pty-1",
          type: "shell",
          status: { kind: "running" },
          motd: "",
        },
        1024,
      ),
    ).toBe("started terminal session pty-1 [type: shell]\n(no startup output)");
    expect(
      renderSpawn(
        {
          sessionId: "pty-2",
          name: "main",
          type: "shell",
          pid: 2,
          status: { kind: "running" },
          motd: "ready",
        },
        1024,
      ),
    ).toContain("pty-2 (main)");
  });

  it("renders running, exited, empty, and truncated sends", () => {
    expect(
      renderSend(
        {
          viewport: "",
          waitReason: "timeout",
          sessionStatus: { kind: "running" },
          truncated: true,
        },
        1024,
      ),
    ).toBe(
      "(no new output)\n[wait: timeout]\n[session: running]\n[output truncated]",
    );
    expect(
      renderSend(
        {
          viewport: "bye",
          waitReason: "session_exit",
          sessionStatus: { kind: "exited", exitCode: null, signal: "SIGTERM" },
          truncated: false,
        },
        1024,
      ),
    ).toContain("exited code=null signal=SIGTERM");
    expect(renderSendRead({ delta: "x", truncated: true })).toBe(
      "x\n[output truncated]",
    );
  });

  it("renders history and every list status shape", () => {
    expect(
      renderRead(
        {
          text: "",
          totalLines: 0,
          lineBegin: 0,
          lineEnd: 0,
          truncated: true,
        },
        1024,
      ),
    ).toBe("(no retained output)\n[lines: 0-0 of 0]\n[output truncated]");
    expect(renderList([], 1024)).toBe("(no terminal sessions)");
    expect(
      renderList(
        [
          {
            sessionId: "pty-1",
            type: "shell",
            status: { kind: "running" },
          },
          {
            sessionId: "pty-2",
            name: "done",
            type: "shell",
            pid: 9,
            status: { kind: "exited", exitCode: 2, signal: null },
          },
        ],
        1024,
      ),
    ).toBe(
      "pty-1 [shell] running\npty-2 (done) [shell] exited code=2 signal=null pid=9",
    );
  });

  it("bounds complete UTF-8 results while retaining terminal metadata when it fits", () => {
    const send = renderSend(
      {
        viewport: `prefix-${"界".repeat(40)}`,
        waitReason: "stdin_read",
        sessionStatus: { kind: "running" },
        truncated: false,
      },
      64,
    );
    expect(Buffer.byteLength(send)).toBeLessThanOrEqual(64);
    expect(send).toContain("[wait: stdin_read]");
    expect(send).toContain("[output truncated]");
    expect(boundTerminalText("x".repeat(200), 32).endsWith("[output truncated]")).toBe(
      true,
    );
  });
});
