/**
 * Bun tests for OpenCode → Host tool-name remapping.
 * Run: `bun test extensions/xrk-sunflower-free/remap-tools.test.ts`
 */
import { describe, expect, test } from "bun:test";
import {
  buildUpstreamBody,
  remapDownstreamCompletionJson,
  remapDownstreamToolCall,
} from "./sidecar.ts";

describe("remapDownstreamToolCall", () => {
  test("maps read → read_file", () => {
    const out = remapDownstreamToolCall({
      id: "c1",
      type: "function",
      function: { name: "read", arguments: '{"path":"a.txt"}' },
    }) as { function: { name: string; arguments: string } };
    expect(out.function.name).toBe("read_file");
    expect(out.function.arguments).toBe('{"path":"a.txt"}');
  });

  test("maps shell → bash and timeout → timeout_ms", () => {
    const out = remapDownstreamToolCall({
      id: "c2",
      type: "function",
      function: {
        name: "shell",
        arguments: '{"command":"ls","workdir":"C:\\\\tmp","timeout":5000}',
      },
    }) as { function: { name: string; arguments: string } };
    expect(out.function.name).toBe("bash");
    const args = JSON.parse(out.function.arguments) as Record<string, unknown>;
    expect(args.command).toBe("ls");
    expect(args.workdir).toBe("C:\\tmp");
    expect(args.timeout_ms).toBe(5000);
    expect(args.timeout).toBeUndefined();
  });

  test("leaves Host-native tools alone", () => {
    const input = {
      id: "c3",
      function: { name: "read_file", arguments: "{}" },
    };
    expect(remapDownstreamToolCall(input)).toEqual(input);
  });
});

describe("buildUpstreamBody", () => {
  test("strips tool_choice none (v2 FreeTierError)", () => {
    const out = buildUpstreamBody({
      model: "glm-5.3-flash-free",
      messages: [{ role: "user", content: "hi" }],
      tool_choice: "none",
      tools: [],
    });
    expect(out.tool_choice).toBeUndefined();
  });

  test("appends placeholder note for injected read/shell", () => {
    const out = buildUpstreamBody({
      messages: [{ role: "user", content: "hi" }],
    });
    const system = (out.messages as { role: string; content: string }[])[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("placeholders that do nothing");
  });
});

describe("remapDownstreamCompletionJson", () => {
  test("rewrites stream deltas", () => {
    const raw = JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { name: "read", arguments: "" } },
            ],
          },
        },
      ],
    });
    const parsed = JSON.parse(remapDownstreamCompletionJson(raw)) as {
      choices: { delta: { tool_calls: { function: { name: string } }[] } }[];
    };
    expect(parsed.choices[0]?.delta.tool_calls[0]?.function.name).toBe(
      "read_file",
    );
  });
});
