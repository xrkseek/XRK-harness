import type { SecretStore } from "./types.js";

/** In-memory SecretStore for tests / CI (`XRK_SECRETS_BACKEND=memory`). */
export function createMemorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  const keyOf = (service: string, account: string) => `${service}\0${account}`;
  return {
    providerName: "memory",
    kind: "memory",
    available: true,
    async load(service, account) {
      const v = map.get(keyOf(service, account));
      return v !== undefined && v.length > 0 ? v : undefined;
    },
    async save(service, account, value) {
      map.set(keyOf(service, account), value);
    },
    async delete(service, account) {
      return map.delete(keyOf(service, account));
    },
  };
}
