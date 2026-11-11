import { describe, expect, it } from "vitest";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
  type ToolExecuteExtras,
} from "../src/index.js";

describe("ToolExecuteExtras sessionId / runId", () => {
  it("forwards Host session + turn into tool.execute extras", async () => {
    const seen: ToolExecuteExtras[] = [];
    const registry = createToolRegistry();
    registry.register({
      name: "probe",
      description: "probe",
      parameters: { type: "object" },
      async execute(_args, _signal, extras) {
        if (extras) seen.push(extras);
        return { content: "ok" };
      },
    });
    const pipeline = createToolPipeline();
    await runToolDetailed({
      registry,
      call: { id: "call-1", name: "probe", arguments: {} },
      pipeline,
      sessionId: "sess-a",
      runId: "turn-b",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.callId).toBe("call-1");
    expect(seen[0]?.sessionId).toBe("sess-a");
    expect(seen[0]?.runId).toBe("turn-b");
  });
});
