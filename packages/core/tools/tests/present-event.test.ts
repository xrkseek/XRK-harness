import { describe, expect, it } from "vitest";
import {
  parseExitStatus,
  presentToolEventView,
  type ToolDefinition,
} from "../src/index.js";
import type { SessionEvent } from "@xrkseek/protocol";

function call(
  name: string,
  args: unknown,
  id = "c1",
): SessionEvent {
  return {
    type: "tool/call",
    ts: 1,
    turnId: "t",
    stepId: "s",
    call: { id, name, arguments: args },
  };
}

function result(
  name: string,
  content: string,
  extra: { isError?: boolean; id?: string } = {},
): SessionEvent {
  return {
    type: "tool/result",
    ts: 2,
    turnId: "t",
    stepId: "s",
    result: {
      toolCallId: extra.id ?? "c1",
      name,
      content,
      ...(extra.isError ? { isError: true } : {}),
    },
  };
}

describe("parseExitStatus (DSH dsh-shell)", () => {
  it("splits [exit code: N] and defaults a clean exit to 0", () => {
    expect(parseExitStatus("hello\n[exit code: 2]")).toEqual({
      body: "hello",
      exitCode: 2,
    });
    expect(parseExitStatus("ok")).toEqual({ body: "ok", exitCode: 0 });
  });

  it("splits [killed by signal: X]", () => {
    expect(parseExitStatus("out\n[killed by signal: SIGTERM]")).toEqual({
      body: "out",
      signal: "SIGTERM",
    });
  });
});

describe("presentToolEventView (DSH viewFor)", () => {
  it("looks up presentCall / presentResult and skips missing pairing", () => {
    const tool: Pick<ToolDefinition, "presentCall" | "presentResult"> = {
      presentCall: (args) => ({
        card: "generic",
        title: String((args as { q?: string }).q ?? ""),
        kind: "other",
      }),
      presentResult: (_args, res) => ({
        card: "generic",
        content: [{ type: "text", text: res.content }],
      }),
    };
    const getTool = (name: string) => (name === "ping" ? tool : undefined);
    expect(
      presentToolEventView(call("ping", { q: "hi" }), { getTool }),
    ).toEqual({
      for: "call",
      view: { card: "generic", title: "hi", kind: "other" },
    });
    expect(
      presentToolEventView(result("ping", "pong"), { getTool }),
    ).toBeUndefined();
    expect(
      presentToolEventView(result("ping", "pong"), {
        getTool,
        argsFor: (id) =>
          id === "c1" ? { name: "ping", args: { q: "hi" } } : undefined,
      }),
    ).toEqual({
      for: "result",
      view: { card: "generic", content: [{ type: "text", text: "pong" }] },
    });
  });

  it("swallows a throwing presenter (no view)", () => {
    const tool: Pick<ToolDefinition, "presentCall" | "presentResult"> = {
      presentCall: () => {
        throw new Error("bad args");
      },
    };
    expect(
      presentToolEventView(call("x", {}), {
        getTool: () => tool,
      }),
    ).toBeUndefined();
  });

  it("unknown tool / missing presenter → no view (client generic)", () => {
    expect(
      presentToolEventView(call("mcp__fs__list", { dir: "." }), {
        getTool: () => undefined,
      }),
    ).toBeUndefined();
  });
});
