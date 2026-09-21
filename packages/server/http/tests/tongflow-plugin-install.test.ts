import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { handleTongflowStudioHttp } from "../src/dsh-compat/tongflow.js";

function fakeRes(): { res: ServerResponse; status: number; body: () => unknown } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string) {
      raw += chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    body: () => JSON.parse(raw) as Record<string, unknown>,
  };
}

function post(body: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = "POST";
  queueMicrotask(() => {
    req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

describe("POST /tongflow/plugins", () => {
  it("installs through plugin add and does not return accepted", async () => {
    const calls: string[] = [];
    const out = fakeRes();
    const req = new EventEmitter() as IncomingMessage;
    req.method = "POST";
    const pending = handleTongflowStudioHttp(req, out.res, "/tongflow/plugins", {
      pluginsDir: "C:/tmp/plugins",
      installPlugin: async (spec) => {
        calls.push(spec);
        return { ok: true, stdout: "added", stderr: "" };
      },
    });
    req.emit("data", Buffer.from(JSON.stringify({ spec: "./extensions/example-tools" })));
    req.emit("end");
    expect(await pending).toBe(true);
    expect(calls).toEqual(["./extensions/example-tools"]);
    expect(out.status).toBe(200);
    const body = out.body();
    expect(body.ok).toBe(true);
    expect(body.via).toBe("xrkh plugin add");
    expect(body.command).toBe("xrkh plugin add ./extensions/example-tools");
    expect(body).not.toHaveProperty("accepted");
  });

  it("rejects a missing spec without calling plugin add", async () => {
    const out = fakeRes();
    let called = false;
    const req = post("{}");
    const handled = await handleTongflowStudioHttp(req, out.res, "/tongflow/plugins", {
      installPlugin: async () => {
        called = true;
        return { ok: true, stdout: "", stderr: "" };
      },
    });
    expect(handled).toBe(true);
    expect(called).toBe(false);
    expect(out.status).toBe(400);
    expect(out.body().ok).toBe(false);
    expect(out.body()).not.toHaveProperty("accepted");
  });
});
