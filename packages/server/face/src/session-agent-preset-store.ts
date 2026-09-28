/**
 * Per-session agent-preset sidecar (tool-surface badge).
 * Survives Host restart and session LRU eviction — same role as
 * {@link ./session-model-store.js} for model selection.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  FACE_AGENT_PRESET_IDS,
  canonicalAgentPresetId,
} from "./presets-catalog.js";

const VERSION = 1 as const;

interface PersistShape {
  readonly version: typeof VERSION;
  readonly presets: Record<string, string>;
}

function atomicWrite(filePath: string, text: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, filePath);
}

/** Disk path under harness home (`~/.xrk` / productDir). */
export function sessionAgentPresetsPath(productHome: string): string {
  return path.join(productHome, "session-agent-presets.json");
}

/** Load all pinned session badges (empty map when missing/corrupt). */
export function loadSessionAgentPresets(
  filePath: string,
): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as PersistShape;
    if (raw?.version !== VERSION || !raw.presets || typeof raw.presets !== "object") {
      return out;
    }
    for (const [id, preset] of Object.entries(raw.presets)) {
      const sessionId = id.trim();
      const badge = String(preset ?? "").trim();
      if (!sessionId || !FACE_AGENT_PRESET_IDS.has(badge)) continue;
      out.set(sessionId, canonicalAgentPresetId(badge));
    }
  } catch {
    /* missing or unreadable — cold start */
  }
  return out;
}

/** Persist one session badge (merge into the file). */
export function saveSessionAgentPreset(
  filePath: string,
  sessionId: string,
  agentPreset: string,
): void {
  const id = sessionId.trim();
  const badge = agentPreset.trim();
  if (!id || !FACE_AGENT_PRESET_IDS.has(badge)) return;
  const map = loadSessionAgentPresets(filePath);
  map.set(id, canonicalAgentPresetId(badge));
  const presets: Record<string, string> = {};
  for (const [k, v] of map) presets[k] = v;
  const body: PersistShape = { version: VERSION, presets };
  atomicWrite(filePath, `${JSON.stringify(body, null, 2)}\n`);
}

/** Drop one session badge from the sidecar (durable session delete). */
export function clearSessionAgentPreset(
  filePath: string,
  sessionId: string,
): void {
  const id = sessionId.trim();
  if (!id) return;
  const map = loadSessionAgentPresets(filePath);
  if (!map.delete(id)) return;
  const presets: Record<string, string> = {};
  for (const [k, v] of map) presets[k] = v;
  const body: PersistShape = { version: VERSION, presets };
  atomicWrite(filePath, `${JSON.stringify(body, null, 2)}\n`);
}
