import { describe, expect, it } from "vitest";
import {
  assembleThreeLayers,
  createAssembleStep,
  createOutboundPipeline,
  createToolPairStep,
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
    const volatileMsg = req.messages.find((m) =>
      m.content.startsWith("[volatile]"),
    );
    expect(volatileMsg?.role).toBe("user");
    expect(volatileMsg?.content).toContain("sess_1");
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
      roles: ["user", "assistant", "user", "user", "user"],
      contents: [
        "a",
        "b",
        "[current message]",
        "now",
        "[volatile]\ntime: 2026-01-01T00:00:00.000Z\nsession: sess_fixed",
      ],
      tools: ["read_file", "write_file"],
    });
  });

  it("follow-up steps omit current-marker and volatile clock for cache prefix", () => {
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
    expect(req.messages.map((m) => m.content)).toEqual([
      "a",
      "b",
      "\u200b",
      "[volatile]\nsession: sess_fixed",
    ]);
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
});
