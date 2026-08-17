import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fullyQualified, hostListDirectory, hostCreateDirectory } from "../src/host-directory.js";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

describe("host directory (DSH browse shapes)", () => {
  it("fullyQualified matches DSH win32/posix rules", () => {
    expect(fullyQualified("/tmp", "linux")).toBe(true);
    expect(fullyQualified("tmp", "linux")).toBe(false);
    expect(fullyQualified("C:\\Users\\x", "win32")).toBe(true);
    expect(fullyQualified("\\Users\\x", "win32")).toBe(false);
  });

  it("listDirectory defaults to home; rejects relative path", async () => {
    const bad = await hostListDirectory({ path: "relative/only" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("directory-unreadable");

    const listed = await hostListDirectory({});
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.home).toBe(homedir());
    expect(listed.value.path).toBe(path.resolve(homedir()));
    expect(listed.value.crumbs.length).toBeGreaterThan(0);
    expect(listed.value.crumbs.at(-1)?.path).toBe(listed.value.path);
  });

  it("listDirectory + createDirectory round-trip", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-dir-"));
    const listed = await hostListDirectory({ path: root });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.entries.every((e) => typeof e.name === "string")).toBe(
      true,
    );

    const created = await hostCreateDirectory({
      path: root,
      name: "child-box",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.path).toBe(path.join(root, "child-box"));

    const again = await hostListDirectory({ path: root });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.entries.some((e) => e.name === "child-box")).toBe(true);
  });

  it("dispatch host.describe includes optional model; listDirectory wired", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      registry: createProviderRegistry(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const desc = await dispatchFaceMethod(runtime, "host.describe", "hd1", {});
    expect(desc.result.ok).toBe(true);
    if (desc.result.ok) {
      const v = desc.result.value as {
        version: string;
        canOpenPath: boolean;
        model?: string;
        provider?: string;
      };
      expect(v.version).toBe("test");
      expect(v.canOpenPath).toBe(false);
      if (v.provider) {
        expect(typeof v.model === "string" || v.model === undefined).toBe(true);
      }
    }

    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-dir-rpc-"));
    await mkdir(path.join(root, "visible"), { recursive: true });
    await writeFile(path.join(root, "file.txt"), "x", "utf8");
    const listed = await dispatchFaceMethod(runtime, "host.listDirectory", "hl1", {
      path: root,
    });
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const v = listed.result.value as {
        entries: { name: string }[];
        truncated: boolean;
      };
      expect(v.entries.some((e) => e.name === "visible")).toBe(true);
      expect(v.entries.some((e) => e.name === "file.txt")).toBe(false);
      expect(v.truncated).toBe(false);
    }

    const open = await dispatchFaceMethod(runtime, "host.openPath", "ho1", {
      path: root,
    });
    expect(open.result.ok).toBe(false);
    if (!open.result.ok) {
      expect(open.result.error.code).toBe("not-implemented");
    }
  });
});
