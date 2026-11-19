import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createMemoryImageGenProvider } from "@xrkseek/exec-image-gen";
import { createHarnessComposition } from "../preset.js";

describe("harness keyless gen / lsp catalog hygiene", () => {
  it("omits image_generate · video_* · lsp when no Provider is configured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-keyless-"));
    const composition = createHarnessComposition({
      workspaceRoot: root,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      webTools: false,
      imageGenEnv: {},
      videoGenEnv: {},
      videoAnalyzeEnv: {},
    });
    const names = new Set(composition.tools.list().map((t) => t.name));
    expect(names.has("image_generate")).toBe(false);
    expect(names.has("video_generate")).toBe(false);
    expect(names.has("video_analyze")).toBe(false);
    expect(names.has("lsp")).toBe(false);
  });

  it("registers image_generate when a Provider is injected", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-img-"));
    const composition = createHarnessComposition({
      workspaceRoot: root,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      webTools: false,
      lspTools: false,
      videoGenTools: false,
      videoAnalyzeTools: false,
      imageGenTools: createMemoryImageGenProvider(),
    });
    expect(composition.tools.get("image_generate")).toBeDefined();
  });
});
