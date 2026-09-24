import { describe, expect, it } from "vitest";
import {
  createHttpExecEnvironment,
  createLocalExecEnvironment,
  probeHttpExecEnvironment,
  resolveExecEnvironment,
} from "../src/index.js";

function mockServerless() {
  const files = new Map<string, string>([["/workspace/README.md", "# hi\n"]]);

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/health") && method === "GET") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith("/v1/exec") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        argv?: string[];
      };
      const argv = body.argv ?? [];
      if (argv[0] === "echo" && argv[1]) {
        return new Response(
          JSON.stringify({
            stdout: `${argv[1]}\n`,
            stderr: "",
            exitCode: 0,
            signal: null,
            killed: false,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          stdout: "",
          stderr: `unknown: ${argv.join(" ")}`,
          exitCode: 127,
          signal: null,
          killed: false,
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/v1/fs") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        op?: string;
        path?: string;
        content?: string;
      };
      const op = body.op ?? "";
      const p = body.path ?? "";
      if (op === "read") {
        const text = files.get(p) ?? "";
        return new Response(
          JSON.stringify({ content: text, truncated: false }),
          { status: 200 },
        );
      }
      if (op === "write") {
        files.set(p, String(body.content ?? ""));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (op === "stat") {
        const text = files.get(p);
        return new Response(
          JSON.stringify({
            isFile: text !== undefined,
            isDirectory: false,
            size: text?.length ?? 0,
          }),
          { status: 200 },
        );
      }
      if (op === "glob") {
        return new Response(
          JSON.stringify({ paths: [...files.keys()] }),
          { status: 200 },
        );
      }
      if (op === "grep") {
        return new Response(JSON.stringify({ hits: [] }), { status: 200 });
      }
      if (op === "mkdir" || op === "edit" || op === "readBytes") {
        return new Response(JSON.stringify({ ok: true, base64: "" }), {
          status: 200,
        });
      }
      return new Response("bad op", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  };

  return { files, fetchImpl };
}

describe("ExecEnvironment", () => {
  it("local provider exposes fs + subprocess", async () => {
    const provider = createLocalExecEnvironment();
    expect(provider.providerName).toBe("local");
    expect(await provider.isAvailable()).toBe(true);
    const world = await provider.createWorld({ workspaceRoot: process.cwd() });
    expect(world.fs.root).toBeTruthy();
    expect(typeof world.subprocess.spawn).toBe("function");
    world.dispose();
  });

  it("http serverless sample runs exec and fs over REST", async () => {
    const { fetchImpl } = mockServerless();
    const provider = createHttpExecEnvironment({
      baseUrl: "http://exec.test",
      fetchImpl,
      token: "t",
    });
    expect(provider.providerName).toBe("http");
    expect(await provider.isAvailable()).toBe(true);
    const world = await provider.createWorld({
      workspaceRoot: "/workspace",
    });
    const result = await world.subprocess.spawn(["echo", "hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    const read = await world.fs.read("/workspace/README.md");
    expect(read.content).toContain("# hi");
    await world.fs.write("/workspace/out.txt", "ok");
    world.dispose();
  });

  it("resolveExecEnvironment defaults to local; http needs URL", async () => {
    expect(resolveExecEnvironment({ kind: "local" }).providerName).toBe(
      "local",
    );
    expect(() =>
      resolveExecEnvironment({ kind: "http", env: {} }),
    ).toThrow(/XRK_EXEC_ENVIRONMENT_URL/);
    const { fetchImpl } = mockServerless();
    const http = resolveExecEnvironment({
      kind: "http",
      http: { baseUrl: "http://exec.test", fetchImpl },
    });
    expect(http.providerName).toBe("http");
    expect(
      await probeHttpExecEnvironment({
        baseUrl: "http://exec.test",
        fetchImpl,
      }),
    ).toBe(true);
  });
});
