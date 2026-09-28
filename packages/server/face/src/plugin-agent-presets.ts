/**
 * Agent-preset composition rows for `pluginInventory/list.agentPresets`.
 *
 * XRK session badges select a tool surface (not a Cordis plugin tree). Rows
 * are honest composition capabilities derived from {@link FACE_AGENT_PRESETS};
 * Host process / client plugins stay on the snapshot's global `entries`.
 */
import type { FaceRuntime } from "./context.js";
import type { FacePluginFiberPhase } from "./plugin-inventory.js";
import {
  FACE_AGENT_PRESETS,
  type AgentPresetProfile,
} from "./presets-catalog.js";
import { resolveDefaultAgentPreset } from "./settings-document.js";

/** One capability / composition row under a session badge. */
export interface FaceAgentPresetPluginRow {
  readonly entryId: string | null;
  readonly moduleName: string;
  readonly enabled: boolean | "conditional";
  readonly condition?: string;
  readonly fiberPhase: FacePluginFiberPhase;
}

/** One session badge's composition inventory group. */
export interface FaceAgentPresetPluginGroup {
  readonly id: string;
  readonly name?: string;
  readonly isDefault: boolean;
  readonly broken?: string;
  readonly rows: readonly FaceAgentPresetPluginRow[];
}

function capabilityRow(
  moduleName: string,
  enabled: boolean,
  condition?: string,
): FaceAgentPresetPluginRow {
  return {
    entryId: null,
    moduleName,
    enabled: condition !== undefined && enabled ? "conditional" : enabled,
    ...(condition === undefined ? {} : { condition }),
    fiberPhase: enabled ? "active" : null,
  };
}

/** Flatten one badge profile into inspectable composition rows. */
export function compositionRowsForProfile(
  profile: AgentPresetProfile,
): readonly FaceAgentPresetPluginRow[] {
  const harness = profile.composition === "harness";
  const subOn = profile.subagents.mode === "on";
  const depth =
    profile.subagents.maxDepth === undefined
      ? undefined
      : `maxDepth<=${String(profile.subagents.maxDepth)}`;
  return [
    capabilityRow("composition:base", true),
    capabilityRow("composition:harness-tools", harness),
    capabilityRow("composition:web", harness && profile.tools.web),
    capabilityRow("composition:lsp", harness && profile.tools.lsp),
    capabilityRow("composition:pty", harness && profile.tools.pty),
    capabilityRow("composition:subagents", subOn, depth),
  ];
}

/**
 * Build `agentPresets` for the plugin inventory Remote.
 * @param runtime - Face runtime (default badge from settings / CLI boot).
 */
export function listFaceAgentPresetGroups(
  runtime: FaceRuntime,
): readonly FaceAgentPresetPluginGroup[] {
  const defaultId = resolveDefaultAgentPreset(runtime);
  return FACE_AGENT_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.displayName,
    isDefault: preset.id === defaultId,
    rows: compositionRowsForProfile(preset.profile),
  }));
}
