import { describe, expect, it } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  createToolRegistry,
  materializeTools,
} from "@xrkseek/core-tools";
import {
  buildImageGenToolParameters,
  createDefaultImageGenAccess,
  createImageGenTools,
  createMemoryImageGenProvider,
  createOpenAiImageGenProvider,
  IMAGE_GEN_CAPABILITIES_TEXT_ONLY,
  imageGenSupportsEdit,
  minimalPngBytes,
  resolveImageGenCapabilities,
  resolveImageGenReferenceImages,
  type ImageGenCapabilities,
  type ImageGenService,
} from "../src/index.js";

describe("exec-image-gen", () => {
  it("memory provider generates PNG", async () => {
    const svc = createMemoryImageGenProvider();
    const out = await svc.generate({ prompt: "a red cube", n: 2 });
    expect(out.provider).toBe("memory");
    expect(out.modality).toBe("text");
    expect(out.images).toHaveLength(2);
    expect(out.images[0]!.bytes).toEqual(minimalPngBytes());
  });

  it("memory provider edit path records reference images", async () => {
    const svc = createMemoryImageGenProvider();
    expect(imageGenSupportsEdit(svc.capabilities!())).toBe(true);
    const out = await svc.generate({
      prompt: "make it blue",
      referenceImages: [
        { bytes: minimalPngBytes(), mimeType: "image/png", label: "src" },
      ],
    });
    expect(out.modality).toBe("image");
    expect(out.note).toMatch(/edit/);
    expect(out.note).toMatch(/refs=1/);
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
    expect(out.content).toMatch(/modality=text/);
    expect(out.content).toMatch(/attachmentId=/);
    expect(out.content).toMatch(/image_base64=/);
  });

  it("dynamic schema omits edit args for text-only Provider", () => {
    const textOnly = createMemoryImageGenProvider({
      capabilities: IMAGE_GEN_CAPABILITIES_TEXT_ONLY,
    });
    const [tool] = createImageGenTools({ service: textOnly });
    const props = tool!.parameters.properties as Record<string, unknown>;
    expect(props.image_url).toBeUndefined();
    expect(props.reference_image_urls).toBeUndefined();
    expect(props.reference_attachment_ids).toBeUndefined();
    expect(tool!.description).toMatch(/does not accept reference/);
  });

  it("dynamic schema includes edit args when capabilities allow", () => {
    const [tool] = createImageGenTools({
      service: createMemoryImageGenProvider(),
    });
    const props = tool!.parameters.properties as Record<string, unknown>;
    expect(props.image_url).toBeTruthy();
    expect(props.reference_image_urls).toBeTruthy();
    expect(props.reference_attachment_ids).toBeTruthy();
    expect(buildImageGenToolParameters(textCaps()).properties.image_url).toBeUndefined();
  });

  it("tools edit via reference_attachment_ids", async () => {
    const attachments = createMemoryAttachmentStore();
    const saved = await attachments.saveImage({
      data: minimalPngBytes(),
      mediaType: "image/png",
      name: "src.png",
    });
    const [tool] = createImageGenTools({
      service: createMemoryImageGenProvider(),
      env: { XRK_IMAGE_GEN: "memory" },
      attachments,
    });
    const out = await tool!.execute({
      prompt: "warmer tones",
      reference_attachment_ids: [saved.attachmentId],
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/modality=image/);
    expect(out.content).toMatch(/refs=1/);
  });

  it("tools reject refs when Provider is text-only", async () => {
    const [tool] = createImageGenTools({
      service: createMemoryImageGenProvider({
        capabilities: IMAGE_GEN_CAPABILITIES_TEXT_ONLY,
      }),
      env: { XRK_IMAGE_GEN: "memory" },
    });
    // Schema omits args, but execute still teaches if replayed.
    const out = await tool!.execute({
      prompt: "x",
      image_url: "data:image/png;base64,aaaa",
    } as { prompt: string; image_url: string });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/does not support reference/);
  });

  it("OpenAI provider generate + edit + default access", async () => {
    expect(createDefaultImageGenAccess({ env: {} }).service).toBeUndefined();
    expect(
      createDefaultImageGenAccess({ env: { XRK_IMAGE_GEN: "memory" } }).service,
    ).toBeTruthy();

    const calls: string[] = [];
    const svc = createOpenAiImageGenProvider({
      apiKey: "sk-test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url.includes("edits") ? "edits" : "generations");
        if (url.includes("edits")) {
          expect(init?.body).toBeInstanceOf(FormData);
        }
        return Response.json({
          data: [
            {
              b64_json: Buffer.from(minimalPngBytes()).toString("base64"),
              revised_prompt: "rev",
            },
          ],
        });
      },
    });
    expect(resolveImageGenCapabilities(svc).maxReferenceImages).toBe(16);

    const gen = await svc.generate({ prompt: "cat" });
    expect(gen.delivery).toBe("openai");
    expect(gen.modality).toBe("text");
    expect(calls).toEqual(["generations"]);

    const edited = await svc.generate({
      prompt: "edit cat",
      referenceImages: [
        { bytes: minimalPngBytes(), mimeType: "image/png" },
      ],
    });
    expect(edited.modality).toBe("image");
    expect(calls).toEqual(["generations", "edits"]);

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

  it("resolves data: and attachment: reference URLs", async () => {
    const attachments = createMemoryAttachmentStore();
    const saved = await attachments.saveImage({
      data: minimalPngBytes(),
      mediaType: "image/png",
      name: "a.png",
    });
    const b64 = Buffer.from(minimalPngBytes()).toString("base64");
    const refs = await resolveImageGenReferenceImages({
      imageUrl: `data:image/png;base64,${b64}`,
      referenceImageUrls: [`attachment:${saved.attachmentId}`],
      attachments,
      maxReferenceImages: 4,
    });
    expect(refs).toHaveLength(2);
    expect(refs[0]!.mimeType).toBe("image/png");
    expect(refs[1]!.label).toBe(saved.attachmentId);
  });

  it("blocks loopback image_url for SSRF safety", async () => {
    await expect(
      resolveImageGenReferenceImages({
        imageUrl: "http://127.0.0.1/secret.png",
        maxReferenceImages: 4,
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("materializeTools rebuilds schema from live capabilities()", () => {
    let caps: ImageGenCapabilities = IMAGE_GEN_CAPABILITIES_TEXT_ONLY;
    const mutable: ImageGenService = {
      capabilities: () => caps,
      async generate() {
        return {
          images: [{ bytes: minimalPngBytes(), mimeType: "image/png" }],
          provider: "mutable",
          delivery: "memory",
        };
      },
    };
    const [tool] = createImageGenTools({ service: mutable });
    const reg = createToolRegistry();
    reg.register(tool!);

    const closed = materializeTools(reg);
    expect(
      (closed.list()[0]!.parameters.properties as Record<string, unknown>)
        .image_url,
    ).toBeUndefined();

    caps = { modalities: ["text", "image"], maxReferenceImages: 4 };
    const open = materializeTools(reg);
    expect(
      (open.list()[0]!.parameters.properties as Record<string, unknown>)
        .image_url,
    ).toBeTruthy();
    expect(tool!.dynamicSchema).toBeTypeOf("function");
  });
});

function textCaps() {
  return IMAGE_GEN_CAPABILITIES_TEXT_ONLY;
}
