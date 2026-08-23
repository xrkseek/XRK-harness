/**
 * Face → dsh-usage-stats provider list bridge (Host wires this).
 */
import { dispatchFaceMethod, type FaceRuntime } from "@xrkseek/server-face";
import type { UsageStatsProviderRow } from "@xrkseek/server-http";

export async function listUsageProvidersFromFace(
  face: FaceRuntime,
): Promise<readonly UsageStatsProviderRow[]> {
  const res = await dispatchFaceMethod(face, "llm.providers", "usage-stats", {});
  if (!res.result.ok) return [];
  const value = res.result.value;
  if (!value || typeof value !== "object") return [];
  const rows = (value as { providers?: unknown }).providers;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const p = row as {
      provider?: string;
      displayName?: string;
      active?: boolean;
    };
    const id = typeof p.provider === "string" ? p.provider : "unknown";
    return {
      id,
      displayName: typeof p.displayName === "string" ? p.displayName : id,
      configured: p.active === true,
      accountMode: "balance",
    };
  });
}

export function createUsageStatsBridgeFromFace(face: FaceRuntime): {
  readonly listUsageProviders: () => Promise<readonly UsageStatsProviderRow[]>;
} {
  return {
    listUsageProviders: () => listUsageProvidersFromFace(face),
  };
}
