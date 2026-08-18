import { describe, expect, it } from "vitest";
import {
  createLspTools,
  presentLspCall,
  type LspService,
} from "../src/index.js";

describe("createLspTools", () => {
  it("registers lsp and fails honestly without a server", async () => {
    const [tool] = createLspTools({ workspaceRoot: "/ws", env: {} });
    expect(tool?.name).toBe("lsp");
    const out = await tool!.execute({
      operation: "hover",
      file_path: "a.ts",
      line: 1,
      character: 1,
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/XRK_LSP_COMMAND/);
    expect(
      presentLspCall({
        operation: "hover",
        file_path: "a.ts",
        line: 1,
        character: 1,
      }).card,
    ).toBe("generic");
  });

  it("renders hover and locations from a stub service", async () => {
    const service: LspService = {
      async query(request) {
        if (request.operation === "hover") {
          return { kind: "hover", hover: { contents: "const ping: string" } };
        }
        return {
          kind: "locations",
          locations: [
            {
              uri: "file:///ws/src/a.ts",
              range: {
                start: { line: 2, character: 0 },
                end: { line: 2, character: 3 },
              },
            },
          ],
          resolvedWorkspaceUri: "file:///ws",
        };
      },
    };
    const [tool] = createLspTools({ workspaceRoot: "/ws", service });
    const hover = await tool!.execute({
      operation: "hover",
      file_path: "src/a.ts",
      line: 1,
      character: 1,
    });
    expect(hover.isError).toBeUndefined();
    expect(hover.content).toBe("const ping: string");
    const def = await tool!.execute({
      operation: "goToDefinition",
      file_path: "src/a.ts",
      line: 1,
      character: 1,
    });
    expect(def.content).toContain("src/a.ts:3:1");
  });
});
