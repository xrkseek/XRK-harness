/**
 * File-backed `settings.yaml` + `.credentials.yaml` for CLI / Face (DSH-shaped).
 */
import { readFileSync } from "node:fs";
import {
  access,
  constants,
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { resolveXrkHome } from "@xrkseek/server-config";
import type { FaceRuntime } from "./context.js";
import {
  FACE_PRODUCT_SETTINGS_NAMESPACES,
  schemaEnvelopeOf,
} from "./settings-schemas.js";
import { FACE_AGENT_PRESET_IDS, canonicalAgentPresetId } from "./presets-catalog.js";
import {
  isFacePermissionPreset,
  validateFaceFontSize,
} from "./face-schema.js";
import {
  listSettingsProviderCredentialRefs,
  providerApiKeyEnv,
} from "./llm-provider-context.js";
import { mergeLayers } from "./settings-layers.js";
import type { FaceSettingsNamespaces } from "./settings-credentials.js";
import {
  ConfigParseError,
  classifyConfigDoc,
  isEnoent,
  keepLastGoodMessage,
  refuseOverwriteDetail,
  type ConfigDocLoad,
} from "./last-good-config.js";

export { mergeLayers } from "./settings-layers.js";
export { ConfigParseError } from "./last-good-config.js";

/** Harness home: explicit `productDir` (tests isolate settings/workspaces), else `XRK_HOME` / `~/.xrk`.
 * Not the workspace product tree — that is always `{workspaceRoot}/.xrk` via `resolveProductDir`.
 */
export function resolveHarnessHome(runtime: FaceRuntime): string {
  if (runtime.productDir?.trim()) return path.resolve(runtime.productDir);
  return resolveXrkHome();
}

export function settingsYamlPath(runtime: FaceRuntime): string {
  return path.join(resolveHarnessHome(runtime), "settings.yaml");
}

export function credentialsYamlPath(runtime: FaceRuntime): string {
  return path.join(resolveHarnessHome(runtime), ".credentials.yaml");
}

/** Last successfully parsed `settings.yaml` docs (keyed by abs path). */
const lastGoodSettingsYamlByFile = new Map<string, Record<string, unknown>>();
/** Last successfully parsed `.credentials.yaml` docs (keyed by abs path). */
const lastGoodCredentialsYamlByFile = new Map<
  string,
  Record<string, unknown>
>();

/** Test helper — clear last-good caches between isolated productDir cases. */
export function resetLastGoodConfigCaches(): void {
  lastGoodSettingsYamlByFile.clear();
  lastGoodCredentialsYamlByFile.clear();
}

function loadYamlDocument(
  file: string,
  lastGood: Record<string, unknown> | undefined,
): ConfigDocLoad {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch (err) {
    if (isEnoent(err)) {
      // Absence is empty — not "keep last good" (that applies to corrupt reload).
      return { status: "missing", doc: {} };
    }
    return {
      status: "invalid",
      error: err instanceof Error ? err.message : String(err),
      doc: lastGood ? structuredClone(lastGood) : {},
    };
  }
  try {
    return classifyConfigDoc(yaml.load(raw), lastGood);
  } catch (err) {
    return {
      status: "invalid",
      error: err instanceof Error ? err.message : String(err),
      doc: lastGood ? structuredClone(lastGood) : {},
    };
  }
}

/**
 * Read YAML mapping. Missing → empty. Invalid → warn + last good for this file
 * (never silently pretend the file was empty for overwrite).
 */
function loadYamlFile(
  file: string,
  kind: "settings" | "credentials",
): Record<string, unknown> {
  const key = path.resolve(file);
  const cache =
    kind === "settings"
      ? lastGoodSettingsYamlByFile
      : lastGoodCredentialsYamlByFile;
  const lastGood = cache.get(key);
  const loaded = loadYamlDocument(file, lastGood);
  if (loaded.status === "ok") {
    cache.set(key, structuredClone(loaded.doc));
    return loaded.doc;
  }
  if (loaded.status === "invalid") {
    console.warn(keepLastGoodMessage(file, loaded.error));
  }
  return loaded.doc;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Default agent preset: settings document → CLI boot preset → minimal. */
export function resolveDefaultAgentPreset(runtime: FaceRuntime): string {
  const slot = runtime.settingsNamespaces.ensure("agent-presets");
  const merged = mergeLayers(
    { default: runtime.defaultAgentPreset ?? "minimal" },
    slot.user,
  );
  const id = merged.default;
  if (typeof id === "string" && FACE_AGENT_PRESET_IDS.has(id)) {
    return canonicalAgentPresetId(id);
  }
  return canonicalAgentPresetId(runtime.defaultAgentPreset ?? "minimal");
}

export function hydrateFaceSettingsDocument(runtime: FaceRuntime): void {
  const doc = loadYamlFile(settingsYamlPath(runtime), "settings");
  for (const spec of FACE_PRODUCT_SETTINGS_NAMESPACES) {
    // MCP SoT is `host-settings.json` (hydrateFaceHostSettings / persistHostSettings).
    // Skipping yaml here avoids dual-source Face vs Host boot (Host never reads yaml).
    if (spec.ns === "mcp") continue;
    const section =
      doc[spec.ns] &&
      typeof doc[spec.ns] === "object" &&
      !Array.isArray(doc[spec.ns])
        ? (doc[spec.ns] as Record<string, unknown>)
        : {};
    const slot = runtime.settingsNamespaces.ensure(spec.ns);
    slot.base = { ...spec.base };
    slot.schema = schemaEnvelopeOf(spec);
    slot.applies = spec.applies;
    slot.user = structuredClone(section);
  }
  applyUiFromSettings(runtime);
  loadCredentialsFile(runtime);
}

function applyUiFromSettings(runtime: FaceRuntime): void {
  const locale = runtime.settingsNamespaces.ensure("locale").user.preference;
  if (typeof locale === "string" && locale.trim()) {
    runtime.uiSettings.locale = locale.trim().toLowerCase().startsWith("zh")
      ? "zh"
      : "en";
  }
  const theme = runtime.settingsNamespaces.ensure("ui-theme").user.preference;
  if (theme === "system" || theme === "light" || theme === "dark") {
    runtime.uiSettings.theme = theme;
  }
}

export function loadCredentialsFile(runtime: FaceRuntime): void {
  const doc = loadYamlFile(credentialsYamlPath(runtime), "credentials");
  for (const [ref, value] of Object.entries(doc)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const slotId = resolveCredentialSlotForRef(runtime, ref);
    if (!slotId) continue;
    runtime.credentials.setFromFile(slotId, value);
  }
}

function resolveCredentialSlotForRef(
  runtime: FaceRuntime,
  ref: string,
): string | undefined {
  if (ref === "XRK_API_KEY") return "host.apiKey";
  if (ref === "XRK_TAVILY_API_KEY") return "web.tavily";
  if (ref === "XRK_BRAVE_SEARCH_API_KEY") return "web.brave";
  if (ref === "XRK_COMPUTER_USE_BACKGROUND") return "computer.background";
  if (ref === "XRK_VOICE_OPENAI_KEY") return "voice.openai";
  if (ref === "XRK_IMAGE_GEN_OPENAI_KEY") return "image.openai";
  if (ref === "XRK_VIDEO_GEN_OPENAI_KEY") return "video.openai";
  if (ref === "XRK_VIDEO_ANALYZE_OPENAI_KEY") return "video-analyze.openai";
  if (ref === "XRK_AUTO_REVIEW_CLASSIFIER_TOKEN") return "auto-review.classifier";
  if (ref === "XRK_MEMORY_EMBED_TOKEN") return "memory-embed.token";
  for (const brand of runtime.registry.listBrands()) {
    if (brand.apiKeyEnv === ref) return `llm.${brand.id}`;
  }
  for (const { providerId, apiKeyEnv } of listSettingsProviderCredentialRefs(
    runtime,
  )) {
    if (apiKeyEnv === ref) return `llm.${providerId}`;
  }
  return undefined;
}

function credentialRefForSlot(
  runtime: FaceRuntime,
  slotId: string,
): string | undefined {
  if (slotId === "host.apiKey") return "XRK_API_KEY";
  if (slotId === "web.tavily") return "XRK_TAVILY_API_KEY";
  if (slotId === "web.brave") return "XRK_BRAVE_SEARCH_API_KEY";
  if (slotId === "computer.background") return "XRK_COMPUTER_USE_BACKGROUND";
  if (slotId === "voice.openai") return "XRK_VOICE_OPENAI_KEY";
  if (slotId === "image.openai") return "XRK_IMAGE_GEN_OPENAI_KEY";
  if (slotId === "video.openai") return "XRK_VIDEO_GEN_OPENAI_KEY";
  if (slotId === "video-analyze.openai") return "XRK_VIDEO_ANALYZE_OPENAI_KEY";
  if (slotId === "auto-review.classifier") return "XRK_AUTO_REVIEW_CLASSIFIER_TOKEN";
  if (slotId === "memory-embed.token") return "XRK_MEMORY_EMBED_TOKEN";
  const brandId = slotId.startsWith("llm.") ? slotId.slice("llm.".length) : "";
  if (!brandId) return undefined;
  const brand = runtime.registry.listBrands().find((b) => b.id === brandId);
  if (brand?.apiKeyEnv) return brand.apiKeyEnv;
  return providerApiKeyEnv(runtime, brandId);
}

export async function persistCredentialsFile(runtime: FaceRuntime): Promise<void> {
  const file = credentialsYamlPath(runtime);
  const key = path.resolve(file);
  await mkdir(path.dirname(file), { recursive: true });
  const loaded = loadYamlDocument(file, lastGoodCredentialsYamlByFile.get(key));
  if (loaded.status === "invalid") {
    throw new ConfigParseError(
      file,
      refuseOverwriteDetail(loaded.error),
    );
  }
  if (loaded.status === "ok") {
    lastGoodCredentialsYamlByFile.set(key, structuredClone(loaded.doc));
  }
  const previous =
    loaded.status === "missing"
      ? {}
      : structuredClone(loaded.doc);
  const next = { ...previous };
  for (const slot of runtime.credentials.listPersistedSlots()) {
    const ref = credentialRefForSlot(runtime, slot.slotId);
    if (!ref) continue;
    if (slot.value === null) delete next[ref];
    else next[ref] = slot.value;
  }
  await writeFile(file, yaml.dump(next, { lineWidth: 120 }), "utf8");
  lastGoodCredentialsYamlByFile.set(key, structuredClone(next));
}

export async function persistSettingsDocument(
  runtime: FaceRuntime,
  namespaces: FaceSettingsNamespaces,
): Promise<void> {
  const file = settingsYamlPath(runtime);
  const key = path.resolve(file);
  await mkdir(path.dirname(file), { recursive: true });
  const loaded = loadYamlDocument(file, lastGoodSettingsYamlByFile.get(key));
  if (loaded.status === "invalid") {
    // DSH: unparsable on-disk document fails the write loud — do not wipe.
    throw new ConfigParseError(
      file,
      refuseOverwriteDetail(loaded.error),
    );
  }
  if (loaded.status === "ok") {
    lastGoodSettingsYamlByFile.set(key, structuredClone(loaded.doc));
  }
  const previous =
    loaded.status === "missing"
      ? {}
      : structuredClone(loaded.doc);
  for (const spec of FACE_PRODUCT_SETTINGS_NAMESPACES) {
    if (spec.ns === "mcp") continue;
    const slot = namespaces.ensure(spec.ns);
    if (Object.keys(slot.user).length === 0) {
      delete previous[spec.ns];
    } else {
      previous[spec.ns] = structuredClone(slot.user);
    }
  }
  await writeFile(file, yaml.dump(previous, { lineWidth: 120 }), "utf8");
  lastGoodSettingsYamlByFile.set(key, structuredClone(previous));
}

export async function ensureSettingsDocument(runtime: FaceRuntime): Promise<string> {
  const file = settingsYamlPath(runtime);
  if (!(await fileExists(file))) {
    await persistSettingsDocument(runtime, runtime.settingsNamespaces);
  }
  return file;
}

export function validateSettingsNamespace(
  ns: string,
  merged: Record<string, unknown>,
): string | undefined {
  if (ns === "permission") {
    const preset = merged.defaultPreset;
    if (preset !== undefined && !isFacePermissionPreset(preset)) {
      return `unknown permission preset: ${String(preset)}`;
    }
  }
  if (ns === "agent-presets") {
    const id = merged.default;
    if (id !== undefined && !FACE_AGENT_PRESET_IDS.has(String(id))) {
      return `unknown agent preset: ${String(id)}`;
    }
  }
  if (ns === "ui-theme") {
    const pref = merged.preference;
    if (
      pref !== undefined &&
      pref !== "system" &&
      pref !== "light" &&
      pref !== "dark"
    ) {
      return `unknown theme preference: ${String(pref)}`;
    }
    const fontSize = merged.fontSize;
    const fontErr = validateFaceFontSize(fontSize);
    if (fontErr) return fontErr;
  }
  if (ns === "ssh-remote") {
    const host = String(merged.host ?? "").trim();
    const workspace = String(merged.workspace ?? "").trim();
    if ((host && !workspace) || (!host && workspace)) {
      return "ssh-remote requires both host and workspace, or neither";
    }
    if (workspace && !workspace.startsWith("/")) {
      return "ssh-remote.workspace must be an absolute remote path (POSIX, starting with /)";
    }
    const port = merged.port;
    if (port !== undefined && port !== null && port !== "") {
      const n = typeof port === "number" ? port : Number(port);
      if (!Number.isFinite(n) || n < 1 || n > 65535) {
        return `ssh-remote.port must be 1–65535, got ${String(port)}`;
      }
    }
  }
  if (ns === "auto-review") {
    const url = String(merged.classifierUrl ?? "").trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return "auto-review.classifierUrl must be an http(s) URL, or empty for heuristic";
    }
  }
  if (ns === "memory-embed") {
    const url = String(merged.url ?? "").trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return "memory-embed.url must be an http(s) URL, or empty for embedded host";
    }
  }
  return undefined;
}

/**
 * Sync peek of one namespace's user layer from `{harnessHome}/settings.yaml`.
 * Used by Host before Face exists (SSH world must bind workspaceRoot at spawn).
 */
export function peekSettingsYamlSection(
  harnessHome: string,
  ns: string,
): Record<string, unknown> | undefined {
  const file = path.join(path.resolve(harnessHome), "settings.yaml");
  const doc = loadYamlFile(file, "settings");
  const section = doc[ns];
  if (
    section === null ||
    section === undefined ||
    typeof section !== "object" ||
    Array.isArray(section)
  ) {
    return undefined;
  }
  return section as Record<string, unknown>;
}
