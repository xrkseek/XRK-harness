/**
 * Effective MCP `allowConnect` from Face namespace layers.
 * Schema base defaults to true; user layer may override.
 * Public runtime helper stays `faceMcpAllowConnect(runtime)` in settings-credentials.
 */
import { mergeLayers } from "./settings-layers.js";

export type FaceMcpAllowSlot = {
  readonly base: Record<string, unknown>;
  readonly user: Record<string, unknown>;
};

/**
 * Merged base+user — product default **on** when neither layer sets the bit
 * (`FACE_PRODUCT_SETTINGS_NAMESPACES` mcp base / schema intent).
 * Do not treat a missing key as deny: `settings.describe` used to stamp
 * `allowConnect: false` into base via a circular read of an empty slot.
 */
export function mcpAllowFromLayers(slot: FaceMcpAllowSlot): boolean {
  const merged = mergeLayers(slot.base, slot.user) as {
    allowConnect?: unknown;
  };
  if (merged.allowConnect === undefined) return true;
  return merged.allowConnect === true;
}
