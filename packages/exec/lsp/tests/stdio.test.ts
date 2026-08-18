import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createStdioLspService } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("./fixtures/mock-lsp-server.mjs", import.meta.url),
);

describe("stdio LSP provider", () => {
  const services: Array<{ dispose(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(services.splice(0).map((s) => s.dispose()));
  });

  it("queries a mock language server", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-lsp-"));
    const src = path.join(root, "src");
    await mkdir(src);
    await writeFile(path.join(src, "a.ts"), "export const ping = 1;\n", "utf8");

    const service = createStdioLspService({
      command: process.execPath,
      args: [fixture],
    });
    services.push(service);

    const hover = await service.query({
      operation: "hover",
      filePath: "src/a.ts",
      position: { line: 0, character: 13 },
      workspaceRoot: root,
    });
    expect(hover).toEqual({
      kind: "hover",
      hover: { contents: "const ping: string" },
    });

    const def = await service.query({
      operation: "goToDefinition",
      filePath: "src/a.ts",
      position: { line: 0, character: 13 },
      workspaceRoot: root,
    });
    expect(def.kind).toBe("locations");
    if (def.kind === "locations") {
      expect(def.locations[0]?.range.start).toEqual({ line: 2, character: 0 });
    }

    const refs = await service.query({
      operation: "findReferences",
      filePath: "src/a.ts",
      position: { line: 0, character: 13 },
      workspaceRoot: root,
    });
    expect(refs.kind).toBe("locations");
    if (refs.kind === "locations") {
      expect(refs.locations).toHaveLength(2);
    }

    const impl = await service.query({
      operation: "goToImplementation",
      filePath: "src/a.ts",
      position: { line: 0, character: 13 },
      workspaceRoot: root,
    });
    expect(impl.kind).toBe("locations");
    if (impl.kind === "locations") {
      expect(impl.locations[0]?.range.start).toEqual({ line: 8, character: 1 });
    }
  });

  it("rejects paths outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-lsp-out-"));
    const service = createStdioLspService({
      command: process.execPath,
      args: [fixture],
    });
    services.push(service);
    await expect(
      service.query({
        operation: "hover",
        filePath: "../secret.ts",
        position: { line: 0, character: 0 },
        workspaceRoot: root,
      }),
    ).rejects.toMatchObject({ code: "LSP_PATH" });
  });
});
