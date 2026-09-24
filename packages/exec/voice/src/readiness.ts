/**
 * Shared Voice readiness facts for Settings UI, doctor, and tool error text.
 * Wake-word / always-on hotword is intentionally out of scope (see docs/voice.md).
 */

export type VoiceAccessKind =
  | "off"
  | "memory"
  | "openai-ready"
  | "openai-missing-key"
  | "unknown";

export interface VoiceAccessDescription {
  readonly kind: VoiceAccessKind;
  /** True when a VoiceService Provider can be constructed without inject. */
  readonly ready: boolean;
  /** Tool-facing `Error: …` line (same wording for UI / doctor / tools). */
  readonly message: string;
  /** Short one-line for `xrkh doctor` / Settings status. */
  readonly summary: string;
}

function resolveFlag(
  env: NodeJS.ProcessEnv,
  product?: { readonly mode?: string },
): string {
  const envRaw = String(env.XRK_VOICE ?? "").trim();
  if (envRaw !== "") return envRaw.toLowerCase();
  if (product?.mode === "openai") return "1";
  return "";
}

function hasApiKey(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    String(env.XRK_VOICE_OPENAI_KEY ?? "").trim() ||
      String(env.OPENAI_API_KEY ?? "").trim(),
  );
}

/**
 * Describe how Voice would resolve for this env + Face product overlay.
 * Does not construct Providers — only readiness / honest-failure copy.
 */
export function describeVoiceAccess(
  env: NodeJS.ProcessEnv = process.env,
  product?: { readonly mode?: string },
): VoiceAccessDescription {
  const flag = resolveFlag(env, product);
  if (!flag) {
    return {
      kind: "off",
      ready: false,
      message:
        "Error: voice Host is not enabled. Use Settings → Plugins → Voice, or set " +
        "XRK_VOICE=memory (CI/demo) / XRK_VOICE=1 with OPENAI_API_KEY / XRK_VOICE_OPENAI_KEY. " +
        "See docs/voice.md.",
      summary:
        "off — tools registered; execute fails honestly until Settings Voice or XRK_VOICE",
    };
  }
  if (flag === "memory") {
    return {
      kind: "memory",
      ready: true,
      message:
        "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE.",
      summary: "memory (CI/demo Provider)",
    };
  }
  if (flag === "1" || flag === "openai") {
    if (!hasApiKey(env)) {
      return {
        kind: "openai-missing-key",
        ready: false,
        message:
          "Error: voice is enabled but no API key. Set Credentials XRK_VOICE_OPENAI_KEY " +
          "(or OPENAI_API_KEY); optional base URL via Settings or XRK_VOICE_BASE_URL.",
        summary:
          "openai enabled but API key missing (Credentials XRK_VOICE_OPENAI_KEY)",
      };
    }
    return {
      kind: "openai-ready",
      ready: true,
      message:
        "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE.",
      summary: "openai-compatible Provider",
    };
  }
  return {
    kind: "unknown",
    ready: false,
    message:
      "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE.",
    summary: `unknown XRK_VOICE=${flag}`,
  };
}

/** Tool execute error string — same facts as {@link describeVoiceAccess}. */
export function voiceUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
  product?: { readonly mode?: string },
): string {
  return describeVoiceAccess(env, product).message;
}
