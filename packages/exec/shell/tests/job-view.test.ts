import { describe, expect, it } from "vitest";
import { toJobView } from "../src/job-view.js";

describe("toJobView detail", () => {
  it("failed bash job surfaces the first stderr line instead of a bare exit code", () => {
    const view = toJobView({
      id: "bash-1",
      kind: "bash",
      command: "npm publish",
      status: "exited",
      exitCode: 1,
      stderr: "npm ERR! code E409\nnpm ERR! Cannot publish over previously staged version",
      startedAt: 1,
      finishedAt: 2,
    });
    expect(view.status).toBe("completed");
    expect(view.detail).toBe("npm ERR! code E409");
  });

  it("failed job without stderr falls back to the exit code", () => {
    const view = toJobView({
      id: "bash-2",
      kind: "bash",
      command: "false",
      status: "exited",
      exitCode: 2,
      startedAt: 1,
    });
    expect(view.detail).toBe("exit code: 2");
  });

  it("managed producer detail wins over generated detail", () => {
    const view = toJobView({
      id: "pty-send-1",
      kind: "pty-send",
      command: "ls",
      status: "exited",
      exitCode: 0,
      detail: "wait: stdin_read",
      startedAt: 1,
    });
    expect(view.detail).toBe("wait: stdin_read");
  });

  it("long error line is bounded", () => {
    const view = toJobView({
      id: "bash-3",
      kind: "bash",
      command: "x",
      status: "exited",
      exitCode: 1,
      stderr: "E".repeat(500),
      startedAt: 1,
    });
    expect(view.detail!.length).toBeLessThanOrEqual(160);
    expect(view.detail!.endsWith("…")).toBe(true);
  });

  it("killed job keeps its exit-code detail", () => {
    const view = toJobView({
      id: "bash-4",
      kind: "bash",
      command: "sleep",
      status: "killed",
      exitCode: null,
      startedAt: 1,
    });
    expect(view.status).toBe("killed");
    expect(view.detail).toBeUndefined();
  });
});