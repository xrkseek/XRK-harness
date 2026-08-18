import { describe, expect, it } from "vitest";
import {
  collectToolCallArgs,
  FaceToolArgMaps,
  faceToolLookup,
  presentToolView,
} from "../src/adapt/index.js";
import type { SessionEvent } from "@xrkseek/protocol";
import type { ToolDefinition } from "@xrkseek/core-tools";

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

const ping: Pick<ToolDefinition, "presentCall" | "presentResult"> = {
  presentCall: (args) => ({
    card: "generic",
    title: String((args as { q?: string }).q ?? "ping"),
    kind: "other",
  }),
  presentResult: (_args, res) =>
    res.isError
      ? undefined
      : { card: "generic", content: [{ type: "text", text: res.content }] },
};

describe("Face tool-view lookup (DSH viewFor)", () => {
  it("without getTool there is no view (client generic)", () => {
    expect(presentToolView(call("bash", { command: "ls" }))).toBeUndefined();
    expect(
      presentToolView(result("write_file", "wrote x")),
    ).toBeUndefined();
  });

  it("looks up the tool presenter; missing pairing skips result", () => {
    const lookup = faceToolLookup((name) =>
      name === "ping" ? ping : undefined,
    );
    expect(presentToolView(call("ping", { q: "hi" }), lookup)).toEqual({
      for: "call",
      view: { card: "generic", title: "hi", kind: "other" },
    });
    expect(presentToolView(result("ping", "pong"), lookup)).toBeUndefined();
  });

  it("FaceToolArgMaps + collectToolCallArgs feed result pairing", () => {
    const events: SessionEvent[] = [
      call("ping", { q: "n" }, "w"),
      result("ping", "ok", { id: "w" }),
    ];
    const maps = new FaceToolArgMaps();
    maps.remember("s", events[0]!);
    const lookup = faceToolLookup(
      (name) => (name === "ping" ? ping : undefined),
      maps.forSession("s"),
    );
    expect(presentToolView(events[1]!, lookup)).toEqual({
      for: "result",
      view: { card: "generic", content: [{ type: "text", text: "ok" }] },
    });
    expect(collectToolCallArgs(events).get("w")).toEqual({
      name: "ping",
      args: { q: "n" },
    });
  });

  it("unknown tools stay without a view", () => {
    expect(
      presentToolView(call("mcp__fs__list", { dir: "." }), {
        getTool: () => undefined,
      }),
    ).toBeUndefined();
  });

  it("replays a web search card from tool/result.meta", () => {
    const web: Pick<ToolDefinition, "presentCall" | "presentResult"> = {
      presentCall: (args) => ({
        card: "generic",
        title: String((args as { query?: string }).query ?? ""),
        kind: "search",
      }),
      presentResult: (args, res) => {
        const meta = res.meta as
          | {
              sources: readonly { url: string }[];
              truncated: boolean;
              answer?: string;
            }
          | undefined;
        if (res.isError || !meta) return undefined;
        return {
          card: "web",
          kind: "search",
          title: String((args as { query?: string } | undefined)?.query ?? ""),
          sources: meta.sources,
          truncated: meta.truncated,
          ...(meta.answer !== undefined ? { answer: meta.answer } : {}),
        };
      },
    };
    const event: SessionEvent = {
      type: "tool/result",
      ts: 2,
      turnId: "t",
      stepId: "s",
      result: {
        toolCallId: "c1",
        name: "web_search",
        content: "Sources: …",
        meta: {
          sources: [{ url: "https://example.com/" }],
          truncated: false,
          answer: "hi",
        },
      },
    };
    expect(
      presentToolView(event, {
        getTool: (name) => (name === "web_search" ? web : undefined),
        argsFor: () => ({ name: "web_search", args: { query: "news" } }),
      }),
    ).toEqual({
      for: "result",
      view: {
        card: "web",
        kind: "search",
        title: "news",
        sources: [{ url: "https://example.com/" }],
        truncated: false,
        answer: "hi",
      },
    });
  });
});
