/** Catalog of Face-exposed session agent presets (tool composition badges). */

export interface AgentPresetInfo {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
}

/**
 * Session badges offered in the product UI.
 * Host CLI also accepts `server` (same tools as harness) — see {@link resolveToolPreset}.
 */
export const FACE_AGENT_PRESETS: readonly AgentPresetInfo[] = [
  {
    id: "minimal",
    displayName: "Minimal",
    description:
      "Filesystem + skill + std tools only (no bash / web / lsp / PTY)",
  },
  {
    id: "harness",
    displayName: "XRK Harness",
    description:
      "Full coding agent: fs + bash + web_search/web_fetch + lsp + terminal_*",
  },
];

/** Ids accepted on the wire (includes legacy `server` → harness tools). */
export const FACE_AGENT_PRESET_IDS = new Set<string>([
  ...FACE_AGENT_PRESETS.map((p) => p.id),
  "server",
]);

/**
 * Map session badge / Host `--preset` to the two tool compositions.
 * `server` is the Host-plane CLI name; tools match harness.
 */
export function resolveToolPreset(
  agentPreset: string | undefined,
  hostFallback = "harness",
): "minimal" | "harness" {
  const raw = (agentPreset?.trim() || hostFallback).trim();
  return raw === "minimal" ? "minimal" : "harness";
}

/** Persist only catalog ids (legacy `server` → `harness`). */
export function canonicalAgentPresetId(id: string): "minimal" | "harness" {
  return resolveToolPreset(id, "harness");
}
