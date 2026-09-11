import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/client/workspaces/path.ts";
import { workspaceTitleOf } from "../src/client/sessions/service.ts";

describe("Windows drive-root workspace path (Host-facing)", () => {
  it("keeps join and title qualified for C:\\", () => {
    expect(resolveWorkspacePath("C:\\", "src\\a.ts")).toBe("C:\\src\\a.ts");
    expect(resolveWorkspacePath("C:\\work\\", "src\\a.ts")).toBe(
      "C:\\work\\src\\a.ts",
    );
    expect(resolveWorkspacePath("C:\\", ".")).toBe("C:\\");
    expect(workspaceTitleOf("C:\\")).toBe("C:\\");
    expect(workspaceTitleOf("C:/")).toBe("C:/");
  });
});
