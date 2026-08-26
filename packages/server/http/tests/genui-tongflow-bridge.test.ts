/**
 * GenUI npm + TongFlow Python bridge tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectNpmRefsFromSchema,
  listGenuiNpmComponents,
  mergeGenuiComponentRegistry,
  registerGenuiNpmComponent,
} from "../src/dsh-compat/genui-npm-bridge.js";
import { renderGenuiFromSchema } from "../src/dsh-compat/host-feature-bridge.js";
import {
  executePythonTongflowNode,
  resolveTongflowPythonCommand,
  tryPythonTongflowScan,
} from "../src/dsh-compat/tongflow-python-bridge.js";
import {
  executeExternalTongflowNode,
  executeTongflowNode,
} from "../src/dsh-compat/tongflow-node-runtime.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("genui npm bridge", () => {
  it("registers npm components and merges into render registry", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-genui-npm-"));
    temps.push(home);
    registerGenuiNpmComponent(home, {
      package: "@example/ui",
      exportName: "Button",
    });
    expect(listGenuiNpmComponents(home).length).toBe(1);
    const schema = {
      type: "npm",
      package: "@other/card",
      export: "Card",
    };
    expect(collectNpmRefsFromSchema(schema)).toContain("@other/card/Card");
    const out = renderGenuiFromSchema(schema, { xrkHome: home });
    expect(out.componentRegistry.some((r) => r.includes("@example/ui"))).toBe(true);
    expect(out.componentRegistry.some((r) => r.includes("@other/card"))).toBe(true);
    expect(out.reactTree.type).toBe("NpmComponent");
    expect(mergeGenuiComponentRegistry(["Card"], home, schema).length).toBeGreaterThan(2);
  });
});

describe("tongflow python bridge", () => {
  it("resolves python command when available", () => {
    const cmd = resolveTongflowPythonCommand(process.env);
    if (cmd) {
      const scan = tryPythonTongflowScan(undefined, process.env);
      expect(scan?.python).toBe(true);
    }
  });

  it("executes inline python node when interpreter exists", () => {
    const cmd = resolveTongflowPythonCommand(process.env);
    if (!cmd) return;
    const out = executeTongflowNode("python.demo", {
      kind: "python",
      input: { hello: "xrkh" },
    });
    expect(out.engine).toBe("python-stub");
    expect(out.ok).toBe(true);
  });

  it("returns honest gap when python missing and no env", () => {
    const out = executePythonTongflowNode(
      "python.demo",
      { kind: "python" },
      { env: { XRK_TONGFLOW_PYTHON: "/no/such/python" } },
    );
    expect(out.ok).toBe(false);
  });
});

describe("tongflow external runtime", () => {
  it("returns honest gap when external command missing", () => {
    const out = executeExternalTongflowNode("external.demo", { kind: "external" });
    expect(out.ok).toBe(false);
    expect(out.incomplete).toContain("taskflow-external-runtime");
  });

  it("executes external node via node subprocess", () => {
    const out = executeTongflowNode("external.echo", {
      kind: "external",
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({ok:true}))"],
    });
    expect(out.engine).toBe("external");
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ ok: true });
  });
});
