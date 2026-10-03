import { describe, expect, it } from "vitest";
import {
  createToolRegistry,
  materializeTools,
} from "@xrkseek/core-tools";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { bindSettingsTools } from "../src/settings-agent-tools.js";

describe("bindSettingsTools", () => {
  it("replaces the standing stub so settings_get reaches Face", async () => {
    const shared = createBareFaceRuntime();
    const tools = createToolRegistry();

    // Simulate the presets/standing layer: settings_* registered with no
    // Face impl (the "no Face channel" stub).
    for (const name of ["settings_get", "settings_mutate"]) {
      tools.register({
        name,
        description: "stub",
        parameters: { type: "object", properties: {} },
        async execute() {
          return {
            content: `${name} unavailable (no Face channel)`,
            isError: true,
          };
        },
      });
    }

    bindSettingsTools(tools, shared);

    const getTool = tools.get("settings_get")!;
    expect(getTool).toBeDefined();
    const list = await getTool.execute({});
    expect(list.isError).toBeFalsy();
    expect(String(list.content)).toContain("Host Settings namespaces");

    const mutateTool = tools.get("settings_mutate")!;
    const mutate = await mutateTool.execute({
      ns: "ui-theme",
      ops: [{ op: "set", path: ["preference"], value: "dark" }],
    });
    expect(mutate.isError).toBeFalsy();
    expect(String(mutate.content)).toContain("ok");

    // Rebinding must keep the Face-bound identity (no stale settle).
    bindSettingsTools(tools, shared);
    const table = materializeTools(tools);
    const settled = await table.settle({
      call: {
        id: "c1",
        name: "settings_get",
        arguments: {},
      },
    });
    expect(settled.result.content).not.toContain("Stale tool call");
    expect(settled.result.content).not.toContain("no Face channel");
    expect(settled.result.isError).toBeFalsy();
  });
});
