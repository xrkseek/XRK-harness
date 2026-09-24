import { describe, expect, it } from "vitest";
import {
  assembleThreeLayers,
  createAssembleStep,
  createOutboundPipeline,
  createToolPairStep,
  hasHumanUserText,
  isMetadataOnlyUserMessage,
  textOfContent,
  slashRecipeStep,
} from "../src/index.js";

describe("three-layer assemble", () => {
  it("keeps volatile out of system", () => {
    const req = assembleThreeLayers({
      skeletonSystem: { persona: "PersonaX" },
      history: [{ role: "user", content: "hi" }],
      skeletonUser: { text: "do it" },
      volatile: {
        nowIso: "2026-08-15T00:00:00.000Z",
        sessionId: "sess_1",
        owner: "xrk",
      },
    });
    expect(req.system).toContain("PersonaX");
    expect(req.system).not.toContain("volatile");
    expect(req.system).not.toContain("sess_1");
    expect(req.system).not.toContain("2026-08-15");
    // Folded into the tail of the live human turn -- never a turn of its own.
    expect(
      req.messages.some((m) => textOfContent(m.content).startsWith("[volatile]")),
    ).toBe(
      false,
    );
    const live = req.messages[req.messages.length - 1]!;
    expect(live.role).toBe("user");
    const liveText = textOfContent(live.content);
    expect(liveText).toContain("do it");
    expect(liveText).toContain("sess_1");
    expect(liveText).toContain("owner: xrk");
  });

  it("layer order snapshot with fixed clock", () => {
    const req = assembleThreeLayers({
      skeletonSystem: {
        persona: "You are X.",
        mcpProtocol: "MCP: tools via schema.",
      },
      history: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      skeletonUser: { text: "now" },
      volatile: {
        nowIso: "2026-01-01T00:00:00.000Z",
        sessionId: "sess_fixed",
      },
      tools: [
        { name: "write_file", description: "w", parameters: {} },
        { name: "read_file", description: "r", parameters: {} },
      ],
    });
    expect({
      system: req.system,
      roles: req.messages.map((m) => m.role),
      contents: req.messages.map((m) => m.content),
      tools: req.tools.map((t) => t.name),
    }).toEqual({
      system: "You are X.\n\nMCP: tools via schema.",
      roles: ["user", "assistant", "user"],
      contents: [
        "a",
        "b",
        [
          "[current message]",
          "now",
          "[volatile]\ntime: 2026-01-01T00:00:00.000Z\nsession: sess_fixed\n[/volatile]",
        ].join("\n\n"),
      ],
      tools: ["read_file", "write_file"],
    });
  });

  it("follow-up steps with no human text append nothing at all", () => {
    const req = assembleThreeLayers({
      skeletonSystem: { persona: "P" },
      history: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      skeletonUser: { text: "\u200b" },
      volatile: {
        nowIso: "2026-01-01T00:00:00.000Z",
        sessionId: "sess_fixed",
      },
      includeCurrentMarker: false,
      includeVolatileTime: false,
      tools: [{ name: "echo", description: "e", parameters: {} }],
    });
    expect(req.messages.map((m) => m.content)).toEqual(["a", "b"]);
    expect(req.messages.some(isMetadataOnlyUserMessage)).toBe(false);
  });

  it("cold start with no human text still sends exactly one turn", () => {
    const req = assembleThreeLayers({
      skeletonSystem: { persona: "P" },
      history: [],
      skeletonUser: { text: "\u200b" },
      volatile: { nowIso: "2026-01-01T00:00:00.000Z", sessionId: "sess_cold" },
      includeCurrentMarker: false,
      includeVolatileTime: false,
    });
    expect(req.messages.length).toBe(1);
    expect(textOfContent(req.messages[0]!.content)).toContain("sess_cold");
  });

  it("blank / invisible user text is not a human turn", () => {
    expect(hasHumanUserText("\u200b")).toBe(false);
    expect(hasHumanUserText("  \n")).toBe(false);
    expect(hasHumanUserText("go")).toBe(true);
    expect(
      isMetadataOnlyUserMessage({
        role: "user",
        content: "[volatile]\nsession: s\n[/volatile]",
      }),
    ).toBe(true);
    expect(
      isMetadataOnlyUserMessage({
        role: "user",
        content:
          "[current message]\n\nhi\n\n[volatile]\nsession: s\n[/volatile]",
      }),
    ).toBe(false);
    expect(
      isMetadataOnlyUserMessage({ role: "assistant", content: "" }),
    ).toBe(false);
  });
});

describe("outbound pipeline", () => {
  it("runs middleware in registration order", async () => {
    const spy: string[] = [];
    const pipeline = createOutboundPipeline();
    pipeline.use(async (_ctx, next) => {
      spy.push("slash");
      await next();
    });
    pipeline.use(
      createAssembleStep(() => ({
        system: "s",
        messages: [],
        tools: [],
      })),
    );
    pipeline.use(async (_ctx, next) => {
      spy.push("after-assemble");
      await next();
    });
    pipeline.use(createToolPairStep());
    pipeline.use(slashRecipeStep);
    await pipeline.run({
      request: { system: "", messages: [], tools: [] },
      history: [],
      meta: {},
    });
    expect(spy).toEqual(["slash", "after-assemble"]);
  });

  it("toolPair rejects unpaired calls", async () => {
    const pipeline = createOutboundPipeline();
    pipeline.use(createToolPairStep());
    await expect(
      pipeline.run({
        request: {
          system: "",
          messages: [
            {
              role: "assistant",
              content: "",
              toolCalls: [{ id: "c1", name: "x", arguments: {} }],
            },
          ],
          tools: [],
        },
        history: [],
        meta: {},
      }),
    ).rejects.toThrow(/toolPair/);
  });

  it("toolPair rejects adjacent duplicate assistant tool_calls", async () => {
    const pipeline = createOutboundPipeline();
    pipeline.use(createToolPairStep());
    await expect(
      pipeline.run({
        request: {
          system: "",
          messages: [
            {
              role: "assistant",
              content: "",
              toolCalls: [{ id: "c1", name: "x", arguments: {} }],
            },
            {
              role: "assistant",
              content: "",
              toolCalls: [{ id: "c1", name: "x", arguments: {} }],
            },
            { role: "tool", content: "ok", toolCallId: "c1" },
          ],
          tools: [],
        },
        history: [],
        meta: {},
      }),
    ).rejects.toThrow(/followed by tool messages/);
  });

  it("sorts tools lexicographically by default", () => {
    const req = assembleThreeLayers({
      skeletonSystem: { persona: "P" },
      history: [],
      skeletonUser: { text: "x" },
      volatile: { nowIso: "t", sessionId: "s" },
      tools: [
        { name: "zeta", description: "z", parameters: {} },
        { name: "alpha", description: "a", parameters: {} },
      ],
    });
    expect(req.tools.map((t) => t.name)).toEqual(["alpha", "zeta"]);
  });

  it("honors toolOrder with a single rest marker", () => {
    const tools = [
      { name: "a", description: "", parameters: {} },
      { name: "b", description: "", parameters: {} },
      { name: "c", description: "", parameters: {} },
      { name: "z", description: "", parameters: {} },
    ];
    const req = assembleThreeLayers({
      skeletonSystem: { persona: "P" },
      history: [],
      skeletonUser: { text: "x" },
      volatile: { nowIso: "t", sessionId: "s" },
      tools,
      toolOrder: ["z", " ", "a"],
    });
    expect(req.tools.map((t) => t.name)).toEqual(["z", "b", "c", "a"]);
  });

  it("fails loud on bad toolOrder", () => {
    const tools = [{ name: "a", description: "", parameters: {} }];
    expect(() =>
      assembleThreeLayers({
        skeletonSystem: { persona: "P" },
        history: [],
        skeletonUser: { text: "x" },
        volatile: { nowIso: "t", sessionId: "s" },
        tools,
        toolOrder: ["a"],
      }),
    ).toThrow(/exactly one/);
    expect(() =>
      assembleThreeLayers({
        skeletonSystem: { persona: "P" },
        history: [],
        skeletonUser: { text: "x" },
        volatile: { nowIso: "t", sessionId: "s" },
        tools,
        toolOrder: ["missing", " "],
      }),
    ).toThrow(/unknown tool/);
  });
});
