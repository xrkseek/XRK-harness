/**
 * Session agent-preset pin helpers — keep memory map + disk sidecar aligned.
 */

import type { FaceRuntime } from "./context.js";
import { canonicalAgentPresetId } from "./presets-catalog.js";
import { resolveDefaultAgentPreset } from "./settings-document.js";
import {
  clearSessionAgentPreset,
  saveSessionAgentPreset,
  sessionAgentPresetsPath,
} from "./session-agent-preset-store.js";

/**
 * Durable sidecar only when Face has an explicit harness home (`productDir`, as
 * Host sets) — never invent writes into ambient `~/.xrk` from Face unit tests
 * that omit isolation (same rule as workspaces.json).
 */
function durablePresetHome(runtime: FaceRuntime): string | undefined {
  const home = runtime.productDir?.trim();
  return home ? home : undefined;
}

/**
 * Pin a catalog badge on a session (memory + disk when durable).
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
  const home = durablePresetHome(runtime);
  if (home) saveSessionAgentPreset(sessionAgentPresetsPath(home), id, badge);
}

/** Drop a pinned badge when the session is durably removed. */
export function unpinSessionAgentPreset(
  runtime: FaceRuntime,
  sessionId: string,
): void {
  const id = sessionId.trim();
  if (!id) return;
  runtime.sessionAgentPresets.delete(id);
  const home = durablePresetHome(runtime);
  if (home) clearSessionAgentPreset(sessionAgentPresetsPath(home), id);
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
