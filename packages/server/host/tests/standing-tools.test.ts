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
    expect(
      createStandingToolRegistry({
        workspaceRoot: process.cwd(),
        preset: "server",
      }).get("bash")?.presentCall,
    ).toBeTypeOf("function");
  });
});
