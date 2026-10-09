import { describe, expect, it } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import { createPathOverreachPre } from "../src/path-overreach-pre.js";

describe("createPathOverreachPre", () => {
  const root = path.join(tmpdir(), "xrk-ws-overreach");
  const outside = path.join(tmpdir(), "xrk-outside-file.txt");

  it("continues when pathAccessMode is open", async () => {
    const pre = createPathOverreachPre({
      root: () => root,
      pathAccessMode: () => "open",
      listWritableAllowlist: () => [],
      listReadableAllowlist: () => [],
    });
    const out = await pre({
      call: { id: "1", name: "write_file", arguments: { path: outside } },
      args: { path: outside },
    } as never);
    expect(out).toEqual({ action: "continue", args: { path: outside } });
  });

  it("asks on absolute write outside workspace + allowlist", async () => {
    const pre = createPathOverreachPre({
      root: () => root,
      pathAccessMode: () => "allowlisted",
      listWritableAllowlist: () => [],
      listReadableAllowlist: () => [],
    });
    const out = await pre({
      call: { id: "1", name: "write_file", arguments: { path: outside } },
      args: { path: outside },
    } as never);
    expect(out.action).toBe("ask");
    if (out.action !== "ask") return;
    expect(out.reason).toMatch(/^path-overreach: write /);
    expect(out.displayReason?.en).toMatch(/outside the workspace/);
  });

  it("continues when absolute path is on writable allowlist", async () => {
    const pre = createPathOverreachPre({
      root: () => root,
      pathAccessMode: () => "allowlisted",
      listWritableAllowlist: () => [path.dirname(outside)],
      listReadableAllowlist: () => [path.dirname(outside)],
    });
    const out = await pre({
      call: { id: "1", name: "write_file", arguments: { path: outside } },
      args: { path: outside },
    } as never);
    expect(out).toEqual({ action: "continue", args: { path: outside } });
  });

  it("continues for relative paths", async () => {
    const pre = createPathOverreachPre({
      root: () => root,
      pathAccessMode: () => "allowlisted",
      listWritableAllowlist: () => [],
      listReadableAllowlist: () => [],
    });
    const out = await pre({
      call: { id: "1", name: "write_file", arguments: { path: "rel.txt" } },
      args: { path: "rel.txt" },
    } as never);
    expect(out).toEqual({ action: "continue", args: { path: "rel.txt" } });
  });
});
