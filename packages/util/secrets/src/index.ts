export {
  REDACTED_SECRET,
  redactSecrets,
  wrapLoggerForSecrets,
  type RedactingLogger,
} from "./redact.js";
export {
  SecretStoreError,
  XRK_KEYRING_SERVICE,
  type SecretStore,
  type SecretStoreKind,
} from "./types.js";
export { createMemorySecretStore } from "./memory.js";
export { createOsKeyringStore } from "./keyring.js";
export {
  resolveSecretStore,
  type SecretsBackendKind,
} from "./resolve.js";

import {
  XRK_KEYRING_SERVICE,
  type SecretStore,
} from "./types.js";

/** Persist one Face slot into the keyring when available. Never logs the value. */
export async function syncSlotToSecretStore(
  store: SecretStore | undefined,
  slotId: string,
  value: string | null,
): Promise<void> {
  if (!store?.available) return;
  if (value === null || value === "") {
    await store.delete(XRK_KEYRING_SERVICE, slotId);
    return;
  }
  await store.save(XRK_KEYRING_SERVICE, slotId, value);
}

/** Load one Face slot from the keyring when the vault has no value. */
export async function loadSlotFromSecretStore(
  store: SecretStore | undefined,
  slotId: string,
): Promise<string | undefined> {
  if (!store?.available) return undefined;
  return store.load(XRK_KEYRING_SERVICE, slotId);
}
