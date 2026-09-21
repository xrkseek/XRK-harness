import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAcpServer } from "../src/acp-server.js";

function drive(lines: string[]): {
  input: PassThrough;
  output: PassThrough;
  done: Promise<void>;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createAcpServer({
    input,
    output,
    agentVersion: "test",
    runner: async ({ text, notify }) => {
      notify?.("chunk");
      return { text: `echo:${text}` };
    },
  });
  const done = server.start();
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  return { input, output, done };
}

async function readFrames(output: PassThrough, done: Promise<void>): Promise<unknown[]> {
  const chunks: Buffer[] = [];
  output.on("data", (c: Buffer) => chunks.push(c));
  await done;
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line) as unknown);
}

describe("createAcpServer", () => {
  it("initialize → session/new → session/prompt", async () => {
    const { output, done } = drive([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/tmp/ws" },
      }),
    ]);
    const frames = await readFrames(output, done);
    const init = frames.find(
      (f) => (f as { id?: number }).id === 1,
    ) as { result: { protocolVersion: number; agentInfo: { name: string } } };
    expect(init.result.protocolVersion).toBe(1);
    expect(init.result.agentInfo.name).toBe("xrk-harness");
    const created = frames.find(
      (f) => (f as { id?: number }).id === 2,
    ) as { result: { sessionId: string } };
    expect(created.result.sessionId).toMatch(/^acp_/);
  });

  it("prompt streams a chunk then end_turn", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    let buf = "";
    output.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        lines.push(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    const server = createAcpServer({
      input,
      output,
      runner: async ({ text }) => ({ text: `echo:${text}` }),
    });
    const done = server.start();
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session/new",
        params: { cwd: "/tmp" },
      })}\n`,
    );
    const created = await new Promise<{ result: { sessionId: string } }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("no session/new response")),
          2000,
        );
        const poll = setInterval(() => {
          const hit = lines
            .map((l) => JSON.parse(l) as { id?: number; result?: { sessionId: string } })
            .find((f) => f.id === 1);
          if (hit?.result?.sessionId) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve(hit as { result: { sessionId: string } });
          }
        }, 10);
      },
    );
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/prompt",
        params: {
          sessionId: created.result.sessionId,
          prompt: [{ type: "text", text: "hi" }],
        },
      })}\n`,
    );
    input.end();
    await done;
    const body = lines.join("\n");
    expect(body).toContain("echo:hi");
    expect(body).toContain("end_turn");
  });
});
