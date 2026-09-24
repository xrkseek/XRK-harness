import { createMemorySecretStore } from "./memory.js";
import { createOsKeyringStore } from "./keyring.js";
import type { SecretStore } from "./types.js";

export type SecretsBackendKind = "file" | "keyring" | "memory";

/**
 * Resolve the optional SecretStore overlay.
 * - `file` / unset → undefined (Face `.credentials.yaml` only)
 * - `memory` → in-process store (CI)
 * - `keyring` → OS keyring via optional `keytar` (may be unavailable)
 */
export async function resolveSecretStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretStore | undefined> {
  const raw = String(env.XRK_SECRETS_BACKEND ?? "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "file" || raw === "0" || raw === "off") {
    return undefined;
  }
  if (raw === "memory") {
    return createMemorySecretStore();
  }
  if (raw === "keyring" || raw === "os" || raw === "1") {
    return createOsKeyringStore();
  }
  return undefined;
}
