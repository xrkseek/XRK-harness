import { describe, expect, it } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  createDefaultImageGenAccess,
  createImageGenTools,
  createMemoryImageGenProvider,
  createOpenAiImageGenProvider,
  minimalPngBytes,
} from "../src/index.js";

describe("exec-image-gen", () => {
  it("memory provider generates PNG", async () => {
    const svc = createMemoryImageGenProvider();
    const out = await svc.generate({ prompt: "a red cube", n: 2 });
    expect(out.provider).toBe("memory");
    expect(out.images).toHaveLength(2);
    expect(out.images[0]!.bytes).toEqual(minimalPngBytes());
  });

  it("tools fail honestly without Provider", async () => {
    const [tool] = createImageGenTools({ env: {} });
    const out = await tool!.execute({ prompt: "hi" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/XRK_IMAGE_GEN/);
  });

  it("tools work with memory + optional attachments", async () => {
    const attachments = createMemoryAttachmentStore();
    const [tool] = createImageGenTools({
      service: createMemoryImageGenProvider(),
      env: { XRK_IMAGE_GEN: "memory" },
      attachments,
    });
    const out = await tool!.execute({ prompt: "logo" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/provider=memory/);
    expect(out.content).toMatch(/attachmentId=/);
    expect(out.content).toMatch(/image_base64=/);
  });

  it("OpenAI provider + default access", async () => {
    expect(createDefaultImageGenAccess({ env: {} }).service).toBeUndefined();
    expect(
      createDefaultImageGenAccess({ env: { XRK_IMAGE_GEN: "memory" } }).service,
    ).toBeTruthy();

    const svc = createOpenAiImageGenProvider({
      apiKey: "sk-test",
      fetchImpl: async () =>
        Response.json({
          data: [
            {
              b64_json: Buffer.from(minimalPngBytes()).toString("base64"),
              revised_prompt: "rev",
            },
          ],
        }),
    });
    const out = await svc.generate({ prompt: "cat" });
    expect(out.delivery).toBe("openai");
    expect(out.images[0]!.revisedPrompt).toBe("rev");

    const access = createDefaultImageGenAccess({
      env: { XRK_IMAGE_GEN: "1", OPENAI_API_KEY: "sk-x" },
      fetchImpl: async () =>
        Response.json({
          data: [
            { b64_json: Buffer.from(minimalPngBytes()).toString("base64") },
          ],
        }),
    });
    expect(access.service).toBeTruthy();
    const gen = await access.service!.generate({ prompt: "dog" });
    expect(gen.provider).toBe("openai");

    expect(
      createDefaultImageGenAccess({
        env: { XRK_IMAGE_GEN_OPENAI_KEY: "sk-p" },
        product: { mode: "openai" },
      }).service,
    ).toBeTruthy();
    expect(
      createDefaultImageGenAccess({
        env: {},
        product: { mode: "off" },
      }).service,
    ).toBeUndefined();
  });
});
