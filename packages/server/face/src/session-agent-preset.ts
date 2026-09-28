/**
 * Session agent-preset pin helpers — keep memory map + disk sidecar aligned.
 */

import { resolveXrkHome } from "@xrkseek/server-config";
import type { FaceRuntime } from "./context.js";
import { canonicalAgentPresetId } from "./presets-catalog.js";
import { resolveDefaultAgentPreset } from "./settings-document.js";
import {
  clearSessionAgentPreset,
  saveSessionAgentPreset,
  sessionAgentPresetsPath,
} from "./session-agent-preset-store.js";

/** Resolve harness home the same way settings / model sidecars do. */
function productHomeOf(runtime: FaceRuntime): string {
  if (runtime.productDir?.trim()) return runtime.productDir.trim();
  return resolveXrkHome();
}

/**
 * Pin a catalog badge on a session (memory + disk).
 * Survives LRU eviction and Host restart.
 */
export function pinSessionAgentPreset(
  runtime: FaceRuntime,
  sessionId: string,
  agentPreset: string,
): void {
  const id = sessionId.trim();
  if (!id) return;
  const badge = canonicalAgentPresetId(agentPreset);
  runtime.sessionAgentPresets.set(id, badge);
  saveSessionAgentPreset(sessionAgentPresetsPath(productHomeOf(runtime)), id, badge);
}

/** Drop a pinned badge when the session is durably removed. */
export function unpinSessionAgentPreset(
  runtime: FaceRuntime,
  sessionId: string,
): void {
  const id = sessionId.trim();
  if (!id) return;
  runtime.sessionAgentPresets.delete(id);
  clearSessionAgentPreset(sessionAgentPresetsPath(productHomeOf(runtime)), id);
}

/**
 * Effective tool-surface badge for a session.
 * Always a catalog id — never a sentinel like "(default)".
 */
export function effectiveSessionAgentPreset(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const pinned = runtime.sessionAgentPresets.get(sessionId.trim());
  if (pinned) return pinned;
  return canonicalAgentPresetId(resolveDefaultAgentPreset(runtime));
}
