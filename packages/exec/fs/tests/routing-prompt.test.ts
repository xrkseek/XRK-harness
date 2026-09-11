import { describe, expect, it } from "vitest";
import {
  FS_ROUTING_PROMPT_TEXT,
  SHELL_ROUTING_PROMPT_TEXT,
  formatFsRoutingPrompt,
  formatShellRoutingPrompt,
} from "../src/routing-prompt.js";

describe("formatFsRoutingPrompt", () => {
  it("emits full text when all fs tools are available", () => {
    expect(
      formatFsRoutingPrompt([
        "glob",
        "grep",
        "read_file",
        "apply_edit",
        "write_file",
      ]),
    ).toBe(FS_ROUTING_PROMPT_TEXT);
  });

  it("omits inspect/edit lines when those tools are filtered out", () => {
    const text = formatFsRoutingPrompt(["glob", "grep"]);
    expect(text).toContain("File tools:");
    expect(text).toContain("`glob`");
    expect(text).not.toContain("read_file");
    expect(text).not.toContain("apply_edit");
    expect(text).not.toContain("write_file");
  });

  it("returns empty when no fs tools remain", () => {
    expect(formatFsRoutingPrompt(["bash", "web_search"])).toBe("");
  });
});

describe("formatShellRoutingPrompt", () => {
  it("emits full text when bash, terminal, and jobs are available", () => {
    expect(
      formatShellRoutingPrompt([
        "bash",
        "terminal_open",
        "terminal_send",
        "terminal_read",
        "terminal_list",
        "terminal_close",
        "terminal_signal",
        "job_list",
        "job_output",
        "job_kill",
      ]),
    ).toBe(SHELL_ROUTING_PROMPT_TEXT);
  });

  it("omits terminal and jobs when only bash is available", () => {
    const text = formatShellRoutingPrompt(["bash"]);
    expect(text).toContain("`bash`");
    expect(text).not.toContain("terminal_*");
    expect(text).not.toContain("job_list");
  });

  it("returns empty when shell tools are filtered out", () => {
    expect(formatShellRoutingPrompt(["read_file"])).toBe("");
  });
});
