import { describe, expect, it } from "vitest";
import { createStandingToolRegistry } from "../src/standing-tools.js";

describe("createStandingToolRegistry", () => {
  it("minimal is fs + std (no bash)", () => {
    const names = createStandingToolRegistry({
      workspaceRoot: process.cwd(),
      preset: "minimal",
    })
      .list()
      .map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("todo_write");
    expect(names).not.toContain("bash");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("lsp");
    expect(names).not.toContain("terminal_open");
    expect(names).toContain("skill");
    expect(
      createStandingToolRegistry({
        workspaceRoot: process.cwd(),
        preset: "minimal",
      }).get("read_file")?.presentCall,
    ).toBeTypeOf("function");
  });

  it("harness / server add bash presenters", () => {
    const harness = createStandingToolRegistry({
      workspaceRoot: process.cwd(),
      preset: "harness",
    });
    expect(harness.get("bash")?.presentCall?.({ command: "ls" })).toEqual({
      card: "terminal",
      title: "ls",
    });
    expect(harness.get("web_search")?.presentCall?.({ query: "news" })).toEqual({
      card: "generic",
      title: "news",
      kind: "search",
      rawInput: "news",
    });
    expect(
      harness.get("lsp")?.presentCall?.({
        operation: "hover",
        file_path: "src/a.ts",
        line: 1,
        character: 1,
      }),
    ).toEqual({
      card: "generic",
      kind: "search",
      title: "LSP hover src/a.ts:1:1",
      locations: [{ path: "src/a.ts", line: 1 }],
    });
    expect(
      harness.get("terminal_send")?.presentCall?.({
        sessionId: "pty-1",
        text: "ls",
      }),
    ).toEqual({
      card: "terminal",
      title: "ls",
      description: "Terminal pty-1",
    });
    expect(
      harness.get("terminal_send")?.presentCall?.({
        sessionId: "pty-1",
        text: "ls",
        run_in_background: true,
      }),
    ).toEqual({
      card: "generic",
      title: "Send to terminal pty-1 in background",
      kind: "execute",
      rawInput: "ls",
    });
    expect(
      harness.get("job_output")?.presentCall?.({ job_id: "pty-send-1" }),
    ).toEqual({
      card: "generic",
      title: "Read output from background job pty-send-1",
      kind: "read",
    });
    expect(
      createStandingToolRegistry({
        workspaceRoot: process.cwd(),
        preset: "server",
      }).get("bash")?.presentCall,
    ).toBeTypeOf("function");
    expect(
      createStandingToolRegistry({
        workspaceRoot: process.cwd(),
        preset: "server",
      }).get("web_fetch")?.presentCall,
    ).toBeTypeOf("function");
  });

  it("shell Host standing still has full presenters (session badge may enable web)", () => {
    const names = createStandingToolRegistry({
      workspaceRoot: process.cwd(),
      preset: "shell",
    })
      .list()
      .map((t) => t.name);
    expect(names).toContain("bash");
    expect(names).toContain("terminal_open");
    expect(names).toContain("web_search");
    expect(names).toContain("lsp");
  });

  it("frugal standing table matches full harness tools", () => {
    const frugal = createStandingToolRegistry({
      workspaceRoot: process.cwd(),
      preset: "frugal",
    });
    expect(frugal.get("bash")?.presentCall).toBeTypeOf("function");
    expect(frugal.get("web_search")?.presentCall).toBeTypeOf("function");
  });
});
