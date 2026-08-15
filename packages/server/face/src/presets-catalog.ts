/** Catalog of Face-exposed agent presets (product identity, not business logic). */

export interface AgentPresetInfo {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
}

export const FACE_AGENT_PRESETS: readonly AgentPresetInfo[] = [
  {
    id: "minimal",
    displayName: "Minimal",
    description: "Lean agent composition for tests and embedded hosts",
  },
  {
    id: "harness",
    displayName: "Harness",
    description: "Full local harness with workspace inject and slash recipes",
  },
  {
    id: "server",
    displayName: "Server",
    description: "HTTP/host-oriented server preset",
  },
];

export const FACE_AGENT_PRESET_IDS = new Set(
  FACE_AGENT_PRESETS.map((p) => p.id),
);
