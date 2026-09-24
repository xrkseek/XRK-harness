/**
 * Secret store Definition (Codex keyring-store shape).
 * Face credentials stay the product SoT; this is an optional durable Provider.
 */

export type SecretStoreKind = "memory" | "os-keyring" | "unavailable";

export class SecretStoreError extends Error {
  readonly code: "SECRET_UNAVAILABLE" | "SECRET_BACKEND";

  constructor(
    message: string,
    code: "SECRET_UNAVAILABLE" | "SECRET_BACKEND" = "SECRET_BACKEND",
  ) {
    super(message);
    this.name = "SecretStoreError";
    this.code = code;
  }
}

/**
 * Pluggable secret backend: load / save / delete by (service, account).
 * Implementations must never log the secret value.
 */
export interface SecretStore {
  readonly providerName: string;
  readonly kind: SecretStoreKind;
  /** False when the OS keyring module is missing or the backend refused probe. */
  readonly available: boolean;
  /** Human reason when `available` is false. */
  readonly unavailableMessage?: string;
  load(service: string, account: string): Promise<string | undefined>;
  save(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
}

/** Default keyring service id for XRK Host credentials. */
export const XRK_KEYRING_SERVICE = "xrk-harness";
