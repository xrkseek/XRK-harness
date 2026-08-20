/**
 * File-backed `settings.yaml` + `.credentials.yaml` for CLI / Face (DSH-shaped).
 */
import { readFileSync } from "node:fs";
import {
  access,
  constants,
  mkdir,
  readFile,
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
  listSettingsProviderCredentialRefs,
  providerApiKeyEnv,
} from "./llm-provider-context.js";
import { mergeLayers } from "./settings-layers.js";
import type { FaceSettingsNamespaces } from "./settings-credentials.js";
import { isFacePermissionPreset } from "./face-schema.js";

export { mergeLayers } from "./settings-layers.js";

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

function loadYamlFile(file: string): Record<string, unknown> {
  try {
    const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* absent or malformed */
  }
  return {};
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
  const doc = loadYamlFile(settingsYamlPath(runtime));
  for (const spec of FACE_PRODUCT_SETTINGS_NAMESPACES) {
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
  const doc = loadYamlFile(credentialsYamlPath(runtime));
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
  const brandId = slotId.startsWith("llm.") ? slotId.slice("llm.".length) : "";
  if (!brandId) return undefined;
  const brand = runtime.registry.listBrands().find((b) => b.id === brandId);
  if (brand?.apiKeyEnv) return brand.apiKeyEnv;
  return providerApiKeyEnv(runtime, brandId);
}

export async function persistCredentialsFile(runtime: FaceRuntime): Promise<void> {
  const file = credentialsYamlPath(runtime);
  await mkdir(path.dirname(file), { recursive: true });
  let previous: Record<string, unknown> = {};
  if (await fileExists(file)) {
    try {
      const parsed = yaml.load(await readFile(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        previous = parsed as Record<string, unknown>;
      }
    } catch {
      previous = {};
    }
  }
  const next = { ...previous };
  for (const slot of runtime.credentials.listPersistedSlots()) {
    const ref = credentialRefForSlot(runtime, slot.slotId);
    if (!ref) continue;
    if (slot.value === null) delete next[ref];
    else next[ref] = slot.value;
  }
  await writeFile(file, yaml.dump(next, { lineWidth: 120 }), "utf8");
}

export async function persistSettingsDocument(
  runtime: FaceRuntime,
  namespaces: FaceSettingsNamespaces,
): Promise<void> {
  const file = settingsYamlPath(runtime);
  await mkdir(path.dirname(file), { recursive: true });
  const previous = loadYamlFile(file);
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
  }
  return undefined;
}
