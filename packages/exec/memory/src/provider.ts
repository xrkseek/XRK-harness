/**
 * Pluggable curated-memory backend (Hermes `MemoryProvider` subset for XRK).
 * External providers sit **beside** the default file store — they implement the
 * same `CuratedMemoryStore` surface the `memory` tool already consumes.
 * Not Mnemon / memory-embed (those are search/doc surfaces).
 */

import type { CuratedMemoryStore } from "./store.js";

/**
 * Named curated-memory provider. File + HTTP samples implement this;
 * presets keep injecting `CuratedMemoryStore` (structural subtype).
 */
export interface MemoryProvider extends CuratedMemoryStore {
  /** Stable id (`file` · `http` · plugin name). */
  readonly providerName: string;
  /** Probe before wiring (Hermes `is_available`). */
  isAvailable(): boolean | Promise<boolean>;
}

export type MemoryProviderKind = "file" | "http" | "sqlite";
