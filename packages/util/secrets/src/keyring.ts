/**
 * OS keyring Provider (Codex DefaultKeyringStore shape).
 * Uses optional `keytar` when installed; otherwise available=false (honest).
 */

import {
  SecretStoreError,
  type SecretStore,
} from "./types.js";

interface KeytarApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function tryImportKeytar(): Promise<KeytarApi | undefined> {
  try {
  // Optional native module — install separately (`pnpm add keytar`) when enabling keyring.
  const mod = (await import("keytar")) as {
      default?: KeytarApi;
      getPassword?: KeytarApi["getPassword"];
      setPassword?: KeytarApi["setPassword"];
      deletePassword?: KeytarApi["deletePassword"];
    };
    if (typeof mod.getPassword === "function") {
      return mod as KeytarApi;
    }
    if (mod.default && typeof mod.default.getPassword === "function") {
      return mod.default;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const UNAVAILABLE =
  "OS keyring unavailable (optional package `keytar` not installed or failed to load). " +
  "Face keeps using ~/.xrk/.credentials.yaml. Install keytar and set XRK_SECRETS_BACKEND=keyring to enable.";

/**
 * Build an OS keyring-backed store. Probes `keytar` once; does not throw on miss.
 */
export async function createOsKeyringStore(): Promise<SecretStore> {
  const keytar = await tryImportKeytar();
  if (!keytar) {
    return {
      providerName: "os-keyring",
      kind: "unavailable",
      available: false,
      unavailableMessage: UNAVAILABLE,
      async load() {
        throw new SecretStoreError(UNAVAILABLE, "SECRET_UNAVAILABLE");
      },
      async save() {
        throw new SecretStoreError(UNAVAILABLE, "SECRET_UNAVAILABLE");
      },
      async delete() {
        throw new SecretStoreError(UNAVAILABLE, "SECRET_UNAVAILABLE");
      },
    };
  }

  return {
    providerName: "os-keyring",
    kind: "os-keyring",
    available: true,
    async load(service, account) {
      try {
        const v = await keytar.getPassword(service, account);
        return v && v.length > 0 ? v : undefined;
      } catch (err) {
        throw new SecretStoreError(
          err instanceof Error ? err.message : String(err),
          "SECRET_BACKEND",
        );
      }
    },
    async save(service, account, value) {
      try {
        await keytar.setPassword(service, account, value);
      } catch (err) {
        throw new SecretStoreError(
          err instanceof Error ? err.message : String(err),
          "SECRET_BACKEND",
        );
      }
    },
    async delete(service, account) {
      try {
        return await keytar.deletePassword(service, account);
      } catch (err) {
        throw new SecretStoreError(
          err instanceof Error ? err.message : String(err),
          "SECRET_BACKEND",
        );
      }
    },
  };
}
