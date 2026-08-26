/**
 * Cloud vision LLM routing for vision-router / vision-toolkit (registry-aligned env keys).
 * When provider + model + apiKeyEnv are configured, HTTP analyze paths may call OpenAI-compatible vision APIs.
 */
import { analyzePastePayload, decodePasteImageBuffers } from "./host-feature-bridge.js";
import { inferCloudVisionFromImages } from "./cloud-vision-inference.js";
import { adapterEcho } from "./honest-envelope.js";
import { tag } from "./meta.js";
import { createPersistedSettingsDocStore } from "./persisted-settings-store.js";
import { dshSettingsDefaults } from "./settings-defaults.js";

export const CLOUD_VISION_INCOMPLETE = "cloud-vision-routing" as const;

/** Provider slug → Registry-style apiKeyEnv (no hard-coded vendor URLs). */
export const VISION_PROVIDER_KEY_ENV: Readonly<Record<string, string>> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  together: "TOGETHER_API_KEY",
};

export interface CloudVisionRoute {
  readonly mode: "cloud-routed" | "xrk-bridge";
  readonly configured: boolean;
  readonly routed: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly incomplete?: readonly string[];
}

export interface CloudVisionOptions {
  readonly xrkHome?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function readVisionRouterSettings(
  xrkHome: string | undefined,
): Record<string, unknown> {
  const store = createPersistedSettingsDocStore(
    xrkHome,
    "vision-router",
    dshSettingsDefaults("vision-router"),
  );
  return store.value();
}

export function resolveCloudVisionRoute(
  options: CloudVisionOptions = {},
): CloudVisionRoute {
  const env = options.env ?? process.env;
  const config = readVisionRouterSettings(options.xrkHome);
  const enabled = config.enabled === true;
  const provider = String(config.provider ?? "")
    .trim()
    .toLowerCase();
  const model = String(config.model ?? "").trim();
  const apiKeyEnv = provider ? VISION_PROVIDER_KEY_ENV[provider] : undefined;
  const keyVal = apiKeyEnv ? env[apiKeyEnv] : undefined;
  const hasKey =
    typeof keyVal === "string" && keyVal.trim().length > 0;

  if (enabled && provider && model && hasKey && apiKeyEnv) {
    return {
      mode: "cloud-routed",
      configured: true,
      routed: true,
      provider,
      model,
      apiKeyEnv,
    };
  }

  const incomplete =
    enabled && provider && model && !hasKey
      ? ([CLOUD_VISION_INCOMPLETE] as const)
      : enabled && provider && !model
        ? ([CLOUD_VISION_INCOMPLETE] as const)
        : undefined;

  return {
    mode: "xrk-bridge",
    configured: false,
    routed: false,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(incomplete ? { incomplete } : {}),
  };
}

export function analyzeWithCloudVisionRoute(
  raw: Buffer | string,
  options: CloudVisionOptions = {},
): Record<string, unknown> {
  return buildCloudVisionAnalyzeResponse(raw, options);
}

export async function analyzeWithCloudVisionRouteAsync(
  raw: Buffer | string,
  options: CloudVisionOptions = {},
): Promise<Record<string, unknown>> {
  const route = resolveCloudVisionRoute(options);
  const local = analyzePastePayload(raw);
  if (!route.routed || local.images.length === 0) {
    return buildCloudVisionAnalyzeResponse(raw, options, local, route);
  }

  const buffers = decodePasteImageBuffers(raw);
  const inference = await inferCloudVisionFromImages(
    buffers,
    route,
    options.env ?? process.env,
  );
  const images = local.images.map((img, index) => ({
    ...img,
    ocrText: inference.texts[index] ?? inference.texts[0] ?? img.ocrText,
    ...(inference.inferred ? { cloudInferred: true as const } : {}),
  }));
  const base = buildCloudVisionAnalyzeResponse(
    raw,
    options,
    { images, analyzed: local.analyzed },
    route,
  );

  if (inference.inferred) {
    return {
      ...base,
      images,
      cloudInference: {
        inferred: true,
        provider: inference.provider,
        model: inference.model,
      },
      note: "Cloud multimodal inference via OpenAI-compatible chat/completions.",
    };
  }
  if (inference.incomplete?.length) {
    return tag(
      {
        ...base,
        cloudInference: { inferred: false, error: inference.error },
      },
      inference.incomplete,
    );
  }
  if (inference.error) {
    return {
      ...base,
      cloudInference: { inferred: false, error: inference.error },
      note: `${String(base.note)} Cloud inference failed; local OCR bridge used.`,
    };
  }
  return base;
}

function buildCloudVisionAnalyzeResponse(
  raw: Buffer | string,
  options: CloudVisionOptions = {},
  localOverride?: ReturnType<typeof analyzePastePayload>,
  routeOverride?: CloudVisionRoute,
): Record<string, unknown> {
  const route = routeOverride ?? resolveCloudVisionRoute(options);
  const local = localOverride ?? analyzePastePayload(raw);
  const base = {
    ok: true,
    analyzed: local.analyzed,
    images: local.images,
    mode: route.mode,
    route: {
      configured: route.configured,
      routed: route.routed,
      ...(route.provider ? { provider: route.provider } : {}),
      ...(route.model ? { model: route.model } : {}),
      ...(route.apiKeyEnv ? { apiKeyEnv: route.apiKeyEnv } : {}),
    },
    note: route.routed
      ? "Vision route resolved; use analyze POST for OpenAI-compatible cloud inference or local OCR fallback."
      : "Local OCR + metadata bridge (configure vision-router provider/model + apiKeyEnv for cloud route).",
    ...adapterEcho(),
  };
  if (route.incomplete?.length) {
    return tag(base, route.incomplete);
  }
  return base;
}

export function cloudVisionModelCapabilities(
  options: CloudVisionOptions = {},
): Record<string, unknown> {
  const route = resolveCloudVisionRoute(options);
  const models: Array<Record<string, unknown>> = [
    {
      id: "xrk-local-vision",
      provider: "xrk-bridge",
      modalities: ["image", "text"],
      ocr: true,
    },
  ];
  if (route.routed && route.provider && route.model) {
    models.unshift({
      id: route.model,
      provider: route.provider,
      modalities: ["image", "text"],
      routed: true,
      apiKeyEnv: route.apiKeyEnv,
    });
  }
  return {
    models,
    capabilities: { ocr: true, metadata: true, cloudRoute: route.routed },
    builtinFallback: ["xrk-local-vision"],
    anonymousRpmPerModel: 8,
    route,
    ...adapterEcho(),
  };
}
